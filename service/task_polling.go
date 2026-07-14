package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/samber/lo"
)

// TaskPollingAdaptor 定义轮询所需的最小适配器接口，避免 service -> relay 的循环依赖
type TaskPollingAdaptor interface {
	Init(info *relaycommon.RelayInfo)
	FetchTask(baseURL string, key string, body map[string]any, proxy string) (*http.Response, error)
	ParseTaskResult(body []byte) (*relaycommon.TaskInfo, error)
	// AdjustBillingOnComplete 在任务到达终态（成功/失败）时由轮询循环调用。
	// 返回正数触发差额结算（补扣/退还），返回 0 保持预扣费金额不变。
	AdjustBillingOnComplete(task *model.Task, taskResult *relaycommon.TaskInfo) int
}

// GetTaskAdaptorFunc 由 main 包注入，用于获取指定平台的任务适配器。
// 打破 service -> relay -> relay/channel -> service 的循环依赖。
var GetTaskAdaptorFunc func(platform constant.TaskPlatform) TaskPollingAdaptor

var taskPollingWorkerID = fmt.Sprintf("task-poller-%d-%d", os.Getpid(), time.Now().UnixNano())

const taskPollingLease = 45 * time.Second

// sweepTimedOutTasks 在主轮询之前独立清理超时任务。
// 每次最多处理 100 条，剩余的下个周期继续处理。
// 使用 per-task CAS (UpdateWithStatus) 防止覆盖被正常轮询已推进的任务。
func sweepTimedOutTasks(ctx context.Context) {
	if constant.TaskTimeoutMinutes <= 0 {
		return
	}
	cutoff := time.Now().Unix() - int64(constant.TaskTimeoutMinutes)*60
	tasks := model.GetTimedOutUnfinishedTasks(cutoff, 100)
	if len(tasks) == 0 {
		return
	}

	const legacyTaskCutoff int64 = 1740182400 // 2026-02-22 00:00:00 UTC
	reason := fmt.Sprintf("任务超时（%d分钟）", constant.TaskTimeoutMinutes)
	legacyReason := "任务超时（旧系统遗留任务，不进行退款，请联系管理员）"
	now := time.Now().Unix()
	timedOutCount := 0

	for _, task := range tasks {
		isLegacy := task.SubmitTime > 0 && task.SubmitTime < legacyTaskCutoff

		claimed, err := model.ClaimTask(task.ID, taskPollingWorkerID, time.Now(), taskPollingLease)
		if err != nil {
			if !errors.Is(err, model.ErrTaskLeaseConflict) {
				logger.LogError(ctx, fmt.Sprintf("sweepTimedOutTasks claim error for task %s: %v", task.TaskID, err))
			}
			continue
		}
		if isLegacy || claimed.RequestId == nil {
			_ = model.UpdateClaimedTask(claimed, taskPollingWorkerID, map[string]interface{}{
				"upstream_status":           model.TaskStatusExpired,
				"upstream_result_persisted": true,
				"billing_status":            model.BillingRequestStatusManualReview,
				"billing_last_error":        legacyReason,
				"fail_reason":               legacyReason,
				"finish_time":               now,
				"status":                    model.TaskStatusInProgress,
				"progress":                  "99%",
			}, true)
			continue
		}
		if err := PersistAndFinalizeTaskBilling(ctx, claimed, taskPollingWorkerID, TaskTerminalBillingInput{
			UpstreamStatus: model.TaskStatusExpired,
			FailReason:     reason,
			FinishTime:     now,
		}); err != nil {
			logger.LogError(ctx, fmt.Sprintf("sweepTimedOutTasks billing error for task %s: %v", task.TaskID, err))
			continue
		}
		timedOutCount++
	}

	if timedOutCount > 0 {
		logger.LogInfo(ctx, fmt.Sprintf("sweepTimedOutTasks: timed out %d tasks", timedOutCount))
	}
}

// TaskPollingLoop 主轮询循环，每 15 秒检查一次未完成的任务
func TaskPollingLoop() {
	for {
		time.Sleep(time.Duration(15) * time.Second)
		common.SysLog("任务进度轮询开始")
		ctx := context.TODO()
		sweepTimedOutTasks(ctx)
		allTasks := model.GetAllUnFinishSyncTasks(constant.TaskQueryLimit)
		platformTask := make(map[constant.TaskPlatform][]*model.Task)
		for _, t := range allTasks {
			if model.IsTaskUpstreamTerminal(t.UpstreamStatus) {
				if t.UpstreamStatus == model.TaskStatusSuccess &&
					t.UsageBasis == "waiting_for_usage" &&
					t.UsageWaitUntil > time.Now().Unix() {
					platformTask[t.Platform] = append(platformTask[t.Platform], t)
					continue
				}
				if err := ReconcileTaskBilling(ctx, t); err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("reconcile terminal task failed task_id=%s error=%s",
						t.TaskID, model.SanitizeBillingError(err.Error())))
				}
				continue
			}
			platformTask[t.Platform] = append(platformTask[t.Platform], t)
		}
		for platform, tasks := range platformTask {
			if len(tasks) == 0 {
				continue
			}
			taskChannelM := make(map[int][]string)
			taskM := make(map[string]*model.Task)
			nullTaskIds := make([]int64, 0)
			for _, task := range tasks {
				upstreamID := task.GetUpstreamTaskID()
				if upstreamID == "" {
					// 统计失败的未完成任务
					nullTaskIds = append(nullTaskIds, task.ID)
					continue
				}
				taskM[upstreamID] = task
				taskChannelM[task.ChannelId] = append(taskChannelM[task.ChannelId], upstreamID)
			}
			if len(nullTaskIds) > 0 {
				for _, id := range nullTaskIds {
					if err := failTaskDurably(ctx, id, "upstream task id is empty"); err != nil {
						logger.LogError(ctx, fmt.Sprintf("Fix null task_id task error id=%d: %v", id, err))
					}
				}
			}
			if len(taskChannelM) == 0 {
				continue
			}

			DispatchPlatformUpdate(platform, taskChannelM, taskM)
		}
		common.SysLog("任务进度轮询完成")
	}
}

func failTaskDurably(ctx context.Context, taskID int64, reason string) error {
	claimed, err := model.ClaimTask(taskID, taskPollingWorkerID, time.Now(), taskPollingLease)
	if err != nil {
		return err
	}
	return PersistAndFinalizeTaskBilling(ctx, claimed, taskPollingWorkerID, TaskTerminalBillingInput{
		UpstreamStatus: model.TaskStatusFailure,
		FailReason:     reason,
	})
}

// DispatchPlatformUpdate 按平台分发轮询更新
func DispatchPlatformUpdate(platform constant.TaskPlatform, taskChannelM map[int][]string, taskM map[string]*model.Task) {
	switch platform {
	case constant.TaskPlatformMidjourney:
		// MJ 轮询由其自身处理，这里预留入口
	case constant.TaskPlatformSuno:
		_ = UpdateSunoTasks(context.Background(), taskChannelM, taskM)
	default:
		if err := UpdateVideoTasks(context.Background(), platform, taskChannelM, taskM); err != nil {
			common.SysLog(fmt.Sprintf("UpdateVideoTasks fail: %s", err))
		}
	}
}

// UpdateSunoTasks 按渠道更新所有 Suno 任务
func UpdateSunoTasks(ctx context.Context, taskChannelM map[int][]string, taskM map[string]*model.Task) error {
	for channelId, taskIds := range taskChannelM {
		err := updateSunoTasks(ctx, channelId, taskIds, taskM)
		if err != nil {
			logger.LogError(ctx, fmt.Sprintf("渠道 #%d 更新异步任务失败: %s", channelId, err.Error()))
		}
	}
	return nil
}

func updateSunoTasks(ctx context.Context, channelId int, taskIds []string, taskM map[string]*model.Task) error {
	logger.LogInfo(ctx, fmt.Sprintf("渠道 #%d 未完成的任务有: %d", channelId, len(taskIds)))
	if len(taskIds) == 0 {
		return nil
	}
	ch, err := model.CacheGetChannel(channelId)
	if err != nil {
		common.SysLog(fmt.Sprintf("CacheGetChannel: %v", err))
		for _, upstreamID := range taskIds {
			if t, ok := taskM[upstreamID]; ok {
				if failErr := failTaskDurably(ctx, t.ID, fmt.Sprintf("获取渠道信息失败，请联系管理员，渠道ID：%d", channelId)); failErr != nil {
					logger.LogError(ctx, fmt.Sprintf("UpdateSunoTask durable failure error: %v", failErr))
				}
			}
		}
		return err
	}
	adaptor := GetTaskAdaptorFunc(constant.TaskPlatformSuno)
	if adaptor == nil {
		return errors.New("adaptor not found")
	}
	proxy := ch.GetSetting().Proxy
	resp, err := adaptor.FetchTask(*ch.BaseURL, ch.Key, map[string]any{
		"ids": taskIds,
	}, proxy)
	if err != nil {
		common.SysLog(fmt.Sprintf("Get Task Do req error: %v", err))
		return err
	}
	if resp.StatusCode != http.StatusOK {
		logger.LogError(ctx, fmt.Sprintf("Get Task status code: %d", resp.StatusCode))
		return fmt.Errorf("Get Task status code: %d", resp.StatusCode)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		common.SysLog(fmt.Sprintf("Get Suno Task parse body error: %v", err))
		return err
	}
	var responseItems dto.TaskResponse[[]dto.SunoDataResponse]
	err = common.Unmarshal(responseBody, &responseItems)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("Get Suno Task parse body error2: %v, body: %s", err, string(responseBody)))
		return err
	}
	if !responseItems.IsSuccess() {
		common.SysLog(fmt.Sprintf("渠道 #%d 未完成的任务有: %d, 成功获取到任务数: %s", channelId, len(taskIds), string(responseBody)))
		return err
	}

	for _, responseItem := range responseItems.Data {
		task := taskM[responseItem.TaskID]
		if !taskNeedsUpdate(task, responseItem) {
			continue
		}

		upstreamStatus := lo.If(model.TaskStatus(responseItem.Status) != "", model.TaskStatus(responseItem.Status)).Else(task.UpstreamStatus)
		if upstreamStatus == "" {
			upstreamStatus = task.Status
		}
		task.FailReason = lo.If(responseItem.FailReason != "", responseItem.FailReason).Else(task.FailReason)
		task.SubmitTime = lo.If(responseItem.SubmitTime != 0, responseItem.SubmitTime).Else(task.SubmitTime)
		task.StartTime = lo.If(responseItem.StartTime != 0, responseItem.StartTime).Else(task.StartTime)
		task.FinishTime = lo.If(responseItem.FinishTime != 0, responseItem.FinishTime).Else(task.FinishTime)
		task.Data = responseItem.Data
		if model.IsTaskUpstreamTerminal(upstreamStatus) {
			claimed, claimErr := model.ClaimTask(task.ID, taskPollingWorkerID, time.Now(), taskPollingLease)
			if claimErr != nil {
				if !errors.Is(claimErr, model.ErrTaskLeaseConflict) {
					logger.LogError(ctx, fmt.Sprintf("claim Suno task failed: %v", claimErr))
				}
				continue
			}
			finalQuota := int64(task.Quota)
			if finalizeErr := PersistAndFinalizeTaskBilling(ctx, claimed, taskPollingWorkerID, TaskTerminalBillingInput{
				UpstreamStatus: upstreamStatus,
				FinalQuota:     finalQuota,
				UsageEstimated: upstreamStatus == model.TaskStatusSuccess,
				UsageBasis:     "reserved_quota_no_usage",
				FailReason:     task.FailReason,
				Data:           task.Data,
				FinishTime:     task.FinishTime,
			}); finalizeErr != nil {
				logger.LogError(ctx, fmt.Sprintf("finalize Suno task failed: %v", finalizeErr))
			}
			continue
		}
		snap := task.Snapshot()
		task.UpstreamStatus = upstreamStatus
		task.Status = upstreamStatus
		switch upstreamStatus {
		case model.TaskStatusSubmitted:
			task.Progress = taskcommon.ProgressSubmitted
		case model.TaskStatusQueued:
			task.Progress = taskcommon.ProgressQueued
		case model.TaskStatusInProgress:
			task.Progress = taskcommon.ProgressInProgress
		}
		if _, err = task.UpdateWithStatus(snap.Status); err != nil {
			common.SysLog("UpdateSunoTask task error: " + err.Error())
		}
	}
	return nil
}

// taskNeedsUpdate 检查 Suno 任务是否需要更新
func taskNeedsUpdate(oldTask *model.Task, newTask dto.SunoDataResponse) bool {
	if oldTask.SubmitTime != newTask.SubmitTime {
		return true
	}
	if oldTask.StartTime != newTask.StartTime {
		return true
	}
	if oldTask.FinishTime != newTask.FinishTime {
		return true
	}
	if string(oldTask.Status) != newTask.Status {
		return true
	}
	if oldTask.FailReason != newTask.FailReason {
		return true
	}

	if (oldTask.Status == model.TaskStatusFailure || oldTask.Status == model.TaskStatusSuccess) && oldTask.Progress != "100%" {
		return true
	}

	oldData, _ := common.Marshal(oldTask.Data)
	newData, _ := common.Marshal(newTask.Data)

	sort.Slice(oldData, func(i, j int) bool {
		return oldData[i] < oldData[j]
	})
	sort.Slice(newData, func(i, j int) bool {
		return newData[i] < newData[j]
	})

	if string(oldData) != string(newData) {
		return true
	}
	return false
}

// UpdateVideoTasks 按渠道更新所有视频任务
func UpdateVideoTasks(ctx context.Context, platform constant.TaskPlatform, taskChannelM map[int][]string, taskM map[string]*model.Task) error {
	for channelId, taskIds := range taskChannelM {
		if err := updateVideoTasks(ctx, platform, channelId, taskIds, taskM); err != nil {
			logger.LogError(ctx, fmt.Sprintf("Channel #%d failed to update video async tasks: %s", channelId, err.Error()))
		}
	}
	return nil
}

func updateVideoTasks(ctx context.Context, platform constant.TaskPlatform, channelId int, taskIds []string, taskM map[string]*model.Task) error {
	logger.LogInfo(ctx, fmt.Sprintf("Channel #%d pending video tasks: %d", channelId, len(taskIds)))
	if len(taskIds) == 0 {
		return nil
	}
	cacheGetChannel, err := model.CacheGetChannel(channelId)
	if err != nil {
		for _, upstreamID := range taskIds {
			if t, ok := taskM[upstreamID]; ok {
				if failErr := failTaskDurably(ctx, t.ID, fmt.Sprintf("Failed to get channel info, channel ID: %d", channelId)); failErr != nil {
					logger.LogError(ctx, fmt.Sprintf("UpdateVideoTask durable failure error: %v", failErr))
				}
			}
		}
		return fmt.Errorf("CacheGetChannel failed: %w", err)
	}
	adaptor := GetTaskAdaptorFunc(platform)
	if adaptor == nil {
		return fmt.Errorf("video adaptor not found")
	}
	info := &relaycommon.RelayInfo{}
	info.ChannelMeta = &relaycommon.ChannelMeta{
		ChannelBaseUrl: cacheGetChannel.GetBaseURL(),
	}
	info.ApiKey = cacheGetChannel.Key
	adaptor.Init(info)
	for _, taskId := range taskIds {
		if err := updateVideoSingleTask(ctx, adaptor, cacheGetChannel, taskId, taskM); err != nil {
			logger.LogError(ctx, fmt.Sprintf("Failed to update video task %s: %s", taskId, err.Error()))
		}
		// sleep 1 second between each task to avoid hitting rate limits of upstream platforms
		time.Sleep(1 * time.Second)
	}
	return nil
}

func updateVideoSingleTask(ctx context.Context, adaptor TaskPollingAdaptor, ch *model.Channel, taskId string, taskM map[string]*model.Task) error {
	baseURL := constant.ChannelBaseURLs[ch.Type]
	if ch.GetBaseURL() != "" {
		baseURL = ch.GetBaseURL()
	}
	proxy := ch.GetSetting().Proxy

	task := taskM[taskId]
	if task == nil {
		logger.LogError(ctx, fmt.Sprintf("Task %s not found in taskM", taskId))
		return fmt.Errorf("task %s not found", taskId)
	}
	key := ch.Key

	privateData := task.PrivateData
	if privateData.Key != "" {
		key = privateData.Key
	}
	resp, err := adaptor.FetchTask(baseURL, key, map[string]any{
		"task_id": task.GetUpstreamTaskID(),
		"action":  task.Action,
	}, proxy)
	if err != nil {
		return fmt.Errorf("fetchTask failed for task %s: %w", taskId, err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("readAll failed for task %s: %w", taskId, err)
	}

	logger.LogDebug(ctx, "updateVideoSingleTask response: %s", responseBody)

	snap := task.Snapshot()

	taskResult := &relaycommon.TaskInfo{}
	// try parse as New API response format
	var responseItems dto.TaskResponse[model.Task]
	if err = common.Unmarshal(responseBody, &responseItems); err == nil && responseItems.IsSuccess() {
		logger.LogDebug(ctx, "updateVideoSingleTask parsed as new api response format: %+v", responseItems)
		t := responseItems.Data
		taskResult.TaskID = t.TaskID
		taskResult.Status = string(t.Status)
		taskResult.Url = t.GetResultURL()
		taskResult.Progress = t.Progress
		taskResult.Reason = t.FailReason
		task.Data = t.Data
	} else if taskResult, err = adaptor.ParseTaskResult(responseBody); err != nil {
		return fmt.Errorf("parseTaskResult failed for task %s: %w", taskId, err)
	}

	task.Data = redactVideoResponseBody(responseBody)

	logger.LogDebug(ctx, "updateVideoSingleTask taskResult: %+v", taskResult)

	now := time.Now().Unix()
	if taskResult.Status == "" {
		//taskResult = relaycommon.FailTaskInfo("upstream returned empty status")
		errorResult := &dto.GeneralErrorResponse{}
		if err = common.Unmarshal(responseBody, &errorResult); err == nil {
			openaiError := errorResult.TryToOpenAIError()
			if openaiError != nil {
				// 返回规范的 OpenAI 错误格式，提取错误信息，判断错误是否为任务失败
				if openaiError.Code == "429" {
					// 429 错误通常表示请求过多或速率限制，暂时不认为是任务失败，保持原状态等待下一轮轮询
					return nil
				}

				// 其他错误认为是任务失败，记录错误信息并更新任务状态
				taskResult = relaycommon.FailTaskInfo("upstream returned error")
			} else {
				// unknown error format, log original response
				logger.LogError(ctx, fmt.Sprintf("Task %s returned empty status with unrecognized error format, response: %s", taskId, string(responseBody)))
				taskResult = relaycommon.FailTaskInfo("upstream returned unrecognized message")
			}
		}
	}

	upstreamStatus := model.TaskStatus(taskResult.Status)
	switch upstreamStatus {
	case model.TaskStatusSubmitted:
		task.UpstreamStatus = upstreamStatus
		task.Status = upstreamStatus
		task.Progress = taskcommon.ProgressSubmitted
	case model.TaskStatusQueued:
		task.UpstreamStatus = upstreamStatus
		task.Status = upstreamStatus
		task.Progress = taskcommon.ProgressQueued
	case model.TaskStatusInProgress:
		task.UpstreamStatus = upstreamStatus
		task.Status = upstreamStatus
		task.Progress = taskcommon.ProgressInProgress
		if task.StartTime == 0 {
			task.StartTime = now
		}
	case model.TaskStatusSuccess:
		resultURL := taskcommon.BuildProxyURL(task.TaskID)
		if strings.HasPrefix(taskResult.Url, "data:") {
			resultURL = taskcommon.BuildProxyURL(task.TaskID)
		} else if taskResult.Url != "" {
			resultURL = taskResult.Url
		}
		finalQuota := int64(task.Quota)
		usageAvailable := taskResult.TotalTokens > 0
		usageEstimated := !usageAvailable
		usageBasis := "reserved_quota_no_usage"
		if actualQuota := adaptor.AdjustBillingOnComplete(task, taskResult); actualQuota > 0 {
			finalQuota = int64(actualQuota)
			usageBasis = "adaptor_snapshot"
			usageEstimated = false
		} else if calculated, ok := CalculateTaskQuotaByTokens(task, taskResult.TotalTokens); ok {
			finalQuota = calculated
			usageBasis = "token_usage_snapshot"
			usageEstimated = false
		}
		claimed, claimErr := model.ClaimTask(task.ID, taskPollingWorkerID, time.Now(), taskPollingLease)
		if claimErr != nil {
			if errors.Is(claimErr, model.ErrTaskLeaseConflict) {
				return nil
			}
			return claimErr
		}
		return PersistAndFinalizeTaskBilling(ctx, claimed, taskPollingWorkerID, TaskTerminalBillingInput{
			UpstreamStatus: model.TaskStatusSuccess,
			FinalQuota:     finalQuota,
			UsageTotal:     int64(taskResult.TotalTokens),
			UsageAvailable: usageAvailable,
			UsageEstimated: usageEstimated,
			UsageBasis:     usageBasis,
			ResultURL:      resultURL,
			Data:           task.Data,
			FinishTime:     now,
		})
	case model.TaskStatusFailure, model.TaskStatusCancelled, model.TaskStatusExpired:
		claimed, claimErr := model.ClaimTask(task.ID, taskPollingWorkerID, time.Now(), taskPollingLease)
		if claimErr != nil {
			if errors.Is(claimErr, model.ErrTaskLeaseConflict) {
				return nil
			}
			return claimErr
		}
		return PersistAndFinalizeTaskBilling(ctx, claimed, taskPollingWorkerID, TaskTerminalBillingInput{
			UpstreamStatus: upstreamStatus,
			FailReason:     taskResult.Reason,
			Data:           task.Data,
			FinishTime:     now,
		})
	default:
		return fmt.Errorf("unknown task status %s for task %s", taskResult.Status, task.TaskID)
	}
	if taskResult.Progress != "" {
		task.Progress = taskResult.Progress
	}
	if !snap.Equal(task.Snapshot()) {
		if _, err := task.UpdateWithStatus(snap.Status); err != nil {
			logger.LogError(ctx, fmt.Sprintf("Failed to update task %s: %s", task.TaskID, err.Error()))
		}
	} else {
		// No changes, skip update
		logger.LogDebug(ctx, "No update needed for task %s", task.TaskID)
	}

	return nil
}

func redactVideoResponseBody(body []byte) []byte {
	var m map[string]any
	if err := common.Unmarshal(body, &m); err != nil {
		return body
	}
	resp, _ := m["response"].(map[string]any)
	if resp != nil {
		delete(resp, "bytesBase64Encoded")
		if v, ok := resp["video"].(string); ok {
			resp["video"] = truncateBase64(v)
		}
		if vs, ok := resp["videos"].([]any); ok {
			for i := range vs {
				if vm, ok := vs[i].(map[string]any); ok {
					delete(vm, "bytesBase64Encoded")
				}
			}
		}
	}
	redactInteractionSteps(m)
	b, err := common.Marshal(m)
	if err != nil {
		return body
	}
	return b
}

func redactInteractionSteps(payload map[string]any) {
	steps, ok := payload["steps"].([]any)
	if !ok {
		return
	}
	for _, step := range steps {
		sm, ok := step.(map[string]any)
		if !ok {
			continue
		}
		content, ok := sm["content"].([]any)
		if !ok {
			continue
		}
		for _, item := range content {
			cm, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if mediaType, _ := cm["type"].(string); strings.EqualFold(mediaType, "video") {
				delete(cm, "data")
			}
		}
	}
}

func truncateBase64(s string) string {
	const maxKeep = 256
	if len(s) <= maxKeep {
		return s
	}
	return s[:maxKeep] + "..."
}

// settleTaskBillingOnComplete 任务完成时的统一计费调整。
// 优先级：1. adaptor.AdjustBillingOnComplete 返回正数 → 使用 adaptor 计算的额度
//
//  2. taskResult.TotalTokens > 0 → 按 token 重算
//  3. 都不满足 → 保持预扣额度不变
func settleTaskBillingOnComplete(ctx context.Context, adaptor TaskPollingAdaptor, task *model.Task, taskResult *relaycommon.TaskInfo) {
	actualQuota := task.Quota
	if bc := task.PrivateData.BillingContext; bc != nil && bc.PerCallBilling {
		RecalculateTaskQuota(ctx, task, actualQuota, "按次计费快照结算")
		return
	}
	if adjustedQuota := adaptor.AdjustBillingOnComplete(task, taskResult); adjustedQuota > 0 {
		actualQuota = adjustedQuota
	} else if calculated, ok := CalculateTaskQuotaByTokens(task, taskResult.TotalTokens); ok {
		actualQuota = int(calculated)
	}
	RecalculateTaskQuota(ctx, task, actualQuota, "异步任务快照结算")
}
