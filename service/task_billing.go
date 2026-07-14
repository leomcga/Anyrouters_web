package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

// LogTaskConsumption 记录任务消费日志和统计信息（仅记录，不涉及实际扣费）。
// 实际扣费已由 BillingSession（PreConsumeBilling + SettleBilling）完成。
func LogTaskConsumption(c *gin.Context, info *relaycommon.RelayInfo) {
	tokenName := c.GetString("token_name")
	logContent := fmt.Sprintf("操作 %s", info.Action)
	// 支持任务仅按次计费
	if common.StringsContains(constant.TaskPricePatches, info.OriginModelName) {
		logContent = fmt.Sprintf("%s，按次计费", logContent)
	} else {
		if len(info.PriceData.OtherRatios) > 0 {
			var contents []string
			for key, ra := range info.PriceData.OtherRatios {
				if 1.0 != ra {
					contents = append(contents, fmt.Sprintf("%s: %.2f", key, ra))
				}
			}
			if len(contents) > 0 {
				logContent = fmt.Sprintf("%s, 计算参数：%s", logContent, strings.Join(contents, ", "))
			}
		}
	}
	other := make(map[string]interface{})
	other["is_task"] = true
	other["request_path"] = c.Request.URL.Path
	other["model_price"] = info.PriceData.ModelPrice
	if info.PriceData.ModelRatio > 0 {
		other["model_ratio"] = info.PriceData.ModelRatio
	}
	other["group_ratio"] = info.PriceData.GroupRatioInfo.GroupRatio
	if info.PriceData.GroupRatioInfo.HasSpecialRatio {
		other["user_group_ratio"] = info.PriceData.GroupRatioInfo.GroupSpecialRatio
	}
	if info.IsModelMapped {
		other["is_model_mapped"] = true
		other["upstream_model_name"] = info.UpstreamModelName
	}
	attachQuotaSaturation(c, info, other)
	model.RecordConsumeLog(c, info.UserId, model.RecordConsumeLogParams{
		ChannelId: info.ChannelId,
		ModelName: info.OriginModelName,
		TokenName: tokenName,
		Quota:     info.PriceData.Quota,
		Content:   logContent,
		TokenId:   info.TokenId,
		Group:     info.UsingGroup,
		Other:     other,
	})
	model.UpdateUserUsedQuotaAndRequestCount(info.UserId, info.PriceData.Quota)
	model.UpdateChannelUsedQuota(info.ChannelId, info.PriceData.Quota)
}

// ---------------------------------------------------------------------------
// 异步任务计费辅助函数
// ---------------------------------------------------------------------------

// ApplyTaskOtherRatios applies task multipliers in a deterministic order and
// converts to quota only once after all multipliers have been applied.
func ApplyTaskOtherRatios(baseQuota float64, ratios map[string]float64) int {
	quota, _ := ApplyTaskOtherRatiosChecked(baseQuota, ratios)
	return quota
}

// ApplyTaskOtherRatiosChecked also returns a clamp marker for admin auditing.
func ApplyTaskOtherRatiosChecked(baseQuota float64, ratios map[string]float64) (int, *common.QuotaClamp) {
	keys := make([]string, 0, len(ratios))
	for key := range ratios {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	result := baseQuota
	for _, key := range keys {
		ratio := ratios[key]
		if ratio > 0 && ratio != 1.0 {
			result *= ratio
		}
	}
	return common.QuotaFromFloatChecked(result)
}

// taskBillingOther 从 task 的 BillingContext 构建日志 Other 字段。
func taskBillingOther(task *model.Task) map[string]interface{} {
	other := make(map[string]interface{})
	if bc := task.PrivateData.BillingContext; bc != nil {
		other["model_price"] = bc.ModelPrice
		if bc.ModelRatio > 0 {
			other["model_ratio"] = bc.ModelRatio
		}
		other["group_ratio"] = bc.GroupRatio
		if len(bc.OtherRatios) > 0 {
			for k, v := range bc.OtherRatios {
				other[k] = v
			}
		}
	}
	props := task.Properties
	if props.UpstreamModelName != "" && props.UpstreamModelName != props.OriginModelName {
		other["is_model_mapped"] = true
		other["upstream_model_name"] = props.UpstreamModelName
	}
	return other
}

// taskModelName 从 BillingContext 或 Properties 中获取模型名称。
func taskModelName(task *model.Task) string {
	if bc := task.PrivateData.BillingContext; bc != nil && bc.OriginModelName != "" {
		return bc.OriginModelName
	}
	return task.Properties.OriginModelName
}

// RefundTaskQuota is the compatibility entry for task failures. It never
// mutates wallet or token quota directly; all money movement is delegated to
// the first-batch billing transaction and persistent job infrastructure.
func RefundTaskQuota(ctx context.Context, task *model.Task, reason string) {
	if task == nil {
		return
	}
	task.FailReason = reason
	task.UpstreamStatus = model.TaskStatusFailure
	task.BillingStatus = model.BillingRequestStatusRefundPending
	task.UpstreamResultPersisted = true
	if err := ReconcileTaskBilling(ctx, task); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("task refund reconciliation failed task_id=%s error=%s",
			task.TaskID, model.SanitizeBillingError(err.Error())))
		return
	}
}

// RecalculateTaskQuota 通用的异步差额结算。
// actualQuota 是任务完成后的实际应扣额度，与预扣额度 (task.Quota) 做差额结算。
// reason 用于日志记录（例如 "token重算" 或 "adaptor调整"）。
// clamps 可选：若计算 actualQuota 时发生额度饱和，将其记入日志 admin_info（仅管理员可见）。
func RecalculateTaskQuota(ctx context.Context, task *model.Task, actualQuota int, reason string, clamps ...*common.QuotaClamp) {
	if task == nil || actualQuota < 0 {
		return
	}
	task.FinalQuota = int64(actualQuota)
	task.FinalQuotaDetermined = true
	task.BillingStatus = model.BillingRequestStatusSettlementPending
	task.UpstreamStatus = model.TaskStatusSuccess
	if err := ReconcileTaskBilling(ctx, task); err != nil {
		logger.LogError(ctx, fmt.Sprintf(
			"task settlement reconciliation failed task_id=%s reason=%s error=%s",
			task.TaskID, reason, model.SanitizeBillingError(err.Error()),
		))
	}
}

// RecalculateTaskQuotaByTokens 根据实际 token 消耗重新计费（异步差额结算）。
// 当任务成功且返回了 totalTokens 时，根据模型倍率和分组倍率重新计算实际扣费额度，
// 与预扣费的差额进行补扣或退还。支持钱包和订阅计费来源。
func RecalculateTaskQuotaByTokens(ctx context.Context, task *model.Task, totalTokens int) {
	if totalTokens <= 0 {
		return
	}

	billingContext := task.PrivateData.BillingContext
	if billingContext != nil && billingContext.PerCallBilling {
		return
	}

	if billingContext == nil || billingContext.ModelRatio <= 0 || billingContext.GroupRatio < 0 {
		markTaskManualReview(task, "missing immutable billing snapshot for token recalculation")
		return
	}
	modelRatio := billingContext.ModelRatio
	finalGroupRatio := billingContext.GroupRatio

	var otherRatios map[string]float64
	if billingContext != nil {
		otherRatios = billingContext.OtherRatios
	}

	actualQuota, clamp := ApplyTaskOtherRatiosChecked(
		float64(totalTokens)*modelRatio*finalGroupRatio,
		otherRatios,
	)

	reason := fmt.Sprintf(
		"token重算：tokens=%d, modelRatio=%.2f, groupRatio=%.2f, ratios=%v, source=%s",
		totalTokens,
		modelRatio,
		finalGroupRatio,
		otherRatios,
		"snapshot",
	)
	RecalculateTaskQuota(ctx, task, actualQuota, reason, clamp)
}

func CalculateTaskQuotaByTokens(task *model.Task, totalTokens int) (int64, bool) {
	if task == nil || totalTokens <= 0 {
		return 0, false
	}
	billingContext := task.PrivateData.BillingContext
	if billingContext == nil || billingContext.PerCallBilling ||
		billingContext.ModelRatio <= 0 || billingContext.GroupRatio < 0 {
		return 0, false
	}
	actualQuota, _ := ApplyTaskOtherRatiosChecked(
		float64(totalTokens)*billingContext.ModelRatio*billingContext.GroupRatio,
		billingContext.OtherRatios,
	)
	if actualQuota < 0 {
		return 0, false
	}
	return int64(actualQuota), true
}

type TaskTerminalBillingInput struct {
	UpstreamStatus model.TaskStatus
	FinalQuota     int64
	UsageTotal     int64
	UsageAvailable bool
	UsageEstimated bool
	UsageBasis     string
	FailReason     string
	Progress       string
	ResultURL      string
	Data           []byte
	FinishTime     int64
}

const asyncUsageGracePeriod = 60 * time.Second

func PersistAndFinalizeTaskBilling(ctx context.Context, task *model.Task, workerID string, input TaskTerminalBillingInput) error {
	if task == nil {
		return errors.New("task is nil")
	}
	if !model.IsTaskUpstreamTerminal(input.UpstreamStatus) {
		return errors.New("task is not in an upstream terminal state")
	}
	if input.FinishTime == 0 {
		input.FinishTime = common.GetTimestamp()
	}
	if input.FinalQuota < 0 {
		return errors.New("task final quota must not be negative")
	}
	waitingForUsage := false
	if input.UpstreamStatus == model.TaskStatusSuccess && !input.UsageAvailable {
		if input.FinalQuota == 0 && task.Quota > 0 {
			input.FinalQuota = int64(task.Quota)
		}
		billingContext := task.PrivateData.BillingContext
		if billingContext != nil && !billingContext.PerCallBilling {
			if task.UsageWaitUntil == 0 {
				task.UsageWaitUntil = time.Now().Add(asyncUsageGracePeriod).Unix()
			}
			if task.UsageWaitUntil > time.Now().Unix() {
				waitingForUsage = true
				input.UsageEstimated = false
				input.UsageBasis = "waiting_for_usage"
			}
		}
		if !waitingForUsage {
			input.UsageEstimated = true
			if input.UsageBasis == "" || input.UsageBasis == "waiting_for_usage" {
				input.UsageBasis = "reserved_quota_no_usage"
			}
		}
	}
	billingStatus := model.BillingRequestStatusSettlementPending
	if input.UpstreamStatus != model.TaskStatusSuccess {
		billingStatus = model.BillingRequestStatusRefundPending
		input.FinalQuota = 0
		input.UsageBasis = "upstream_failure"
	}
	finalQuotaDetermined := !waitingForUsage
	updates := map[string]interface{}{
		"upstream_status":           input.UpstreamStatus,
		"upstream_result_persisted": true,
		"price_snapshot_persisted":  task.PrivateData.BillingContext != nil,
		"usage_total":               input.UsageTotal,
		"usage_available":           input.UsageAvailable,
		"usage_estimated":           input.UsageEstimated,
		"usage_basis":               input.UsageBasis,
		"usage_wait_until":          task.UsageWaitUntil,
		"final_quota":               input.FinalQuota,
		"final_quota_determined":    finalQuotaDetermined,
		"billing_status":            billingStatus,
		"billing_last_error":        "",
		"status":                    model.TaskStatusInProgress,
		"progress":                  "99%",
		"finish_time":               input.FinishTime,
		"fail_reason":               input.FailReason,
		"upstream_task_id":          task.GetUpstreamTaskID(),
	}
	if input.ResultURL != "" {
		task.PrivateData.ResultURL = input.ResultURL
		updates["private_data"] = task.PrivateData
	}
	if input.Data != nil {
		updates["data"] = input.Data
	}
	if err := model.UpdateClaimedTask(task, workerID, updates, true); err != nil {
		return err
	}
	if waitingForUsage {
		return nil
	}
	var reloaded model.Task
	if err := model.DB.First(&reloaded, task.ID).Error; err != nil {
		return err
	}
	return ReconcileTaskBilling(ctx, &reloaded)
}

func ReconcileTaskBilling(ctx context.Context, task *model.Task) error {
	if task == nil {
		return errors.New("task is nil")
	}
	if task.RequestId == nil || strings.TrimSpace(*task.RequestId) == "" {
		markTaskManualReview(task, "legacy task has no billing request id")
		return model.ErrBillingRequestNotFound
	}
	requestID := strings.TrimSpace(*task.RequestId)
	if task.UpstreamStatus == model.TaskStatusSuccess &&
		task.UsageBasis == "waiting_for_usage" &&
		task.UsageWaitUntil > time.Now().Unix() {
		return nil
	}
	if task.UpstreamStatus == model.TaskStatusSuccess &&
		task.UsageBasis == "waiting_for_usage" {
		task.UsageEstimated = true
		task.UsageBasis = "reserved_quota_no_usage"
		task.FinalQuota = int64(task.Quota)
		task.FinalQuotaDetermined = true
		if err := model.DB.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]interface{}{
			"usage_estimated":        true,
			"usage_basis":            task.UsageBasis,
			"final_quota":            task.FinalQuota,
			"final_quota_determined": true,
		}).Error; err != nil {
			return err
		}
	}
	var operation string
	var targetQuota int64
	switch task.UpstreamStatus {
	case model.TaskStatusSuccess:
		operation = model.BillingJobOperationSettle
		targetQuota = task.FinalQuota
		if !task.FinalQuotaDetermined {
			targetQuota = int64(task.Quota)
		}
	case model.TaskStatusFailure, model.TaskStatusCancelled, model.TaskStatusExpired:
		operation = model.BillingJobOperationRefund
	default:
		return nil
	}

	var err error
	if operation == model.BillingJobOperationSettle {
		_, err = model.SettleBillingRequest(requestID, targetQuota)
	} else {
		_, err = model.RefundBillingRequest(requestID)
	}
	if err != nil {
		if _, queueErr := model.QueueBillingJob(requestID, operation, targetQuota, err.Error()); queueErr != nil {
			markTaskManualReview(task, fmt.Sprintf("billing failed: %s; queue failed: %s",
				model.SanitizeBillingError(err.Error()), model.SanitizeBillingError(queueErr.Error())))
			return fmt.Errorf("billing operation failed: %w; queue failed: %v", err, queueErr)
		}
		pendingStatus := model.BillingRequestStatusSettlementPending
		if operation == model.BillingJobOperationRefund {
			pendingStatus = model.BillingRequestStatusRefundPending
		}
		_ = model.DB.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]interface{}{
			"billing_status":     pendingStatus,
			"billing_last_error": model.SanitizeBillingError(err.Error()),
			"progress":           "99%",
		}).Error
		return err
	}
	if err := model.SyncTaskFromBillingRequest(task.ID); err != nil {
		return err
	}
	if operation == model.BillingJobOperationSettle {
		task.Quota = int(targetQuota)
		task.FinalQuota = targetQuota
		task.FinalQuotaDetermined = true
		task.BillingStatus = model.BillingRequestStatusSettled
		task.Status = model.TaskStatusSuccess
		if task.UpstreamResultPersisted {
			accounted, accountErr := model.AccountTaskUsage(task.ID, targetQuota)
			if accountErr != nil {
				return accountErr
			}
			if accounted {
				model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{
					UserId:    task.UserId,
					LogType:   model.LogTypeConsume,
					Content:   "异步任务最终结算",
					ChannelId: task.ChannelId,
					ModelName: taskModelName(task),
					Quota:     int(targetQuota),
					TokenId:   task.PrivateData.TokenId,
					Group:     task.Group,
					Other: map[string]interface{}{
						"request_id":      requestID,
						"task_id":         task.TaskID,
						"usage_basis":     task.UsageBasis,
						"usage_estimated": task.UsageEstimated,
					},
				})
			}
		}
	} else {
		task.BillingStatus = model.BillingRequestStatusRefunded
		task.Status = model.TaskStatusFailure
	}
	return nil
}

func markTaskManualReview(task *model.Task, reason string) {
	if task == nil || task.ID <= 0 {
		return
	}
	task.BillingStatus = model.BillingRequestStatusManualReview
	task.BillingLastError = model.SanitizeBillingError(reason)
	_ = model.DB.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]interface{}{
		"billing_status":     model.BillingRequestStatusManualReview,
		"billing_last_error": task.BillingLastError,
		"progress":           "99%",
	}).Error
}

func PersistAndFinalizeMidjourneyBilling(ctx context.Context, task *model.Midjourney, workerID string, upstreamStatus string, failReason string) error {
	if task == nil {
		return errors.New("midjourney task is nil")
	}
	if upstreamStatus != "SUCCESS" && upstreamStatus != "FAILURE" &&
		upstreamStatus != "CANCELLED" && upstreamStatus != "EXPIRED" {
		return errors.New("midjourney task is not terminal")
	}
	billingStatus := model.BillingRequestStatusSettlementPending
	if upstreamStatus != "SUCCESS" {
		billingStatus = model.BillingRequestStatusRefundPending
	}
	if err := model.UpdateClaimedMidjourneyTask(task, workerID, map[string]interface{}{
		"code":                      task.Code,
		"prompt_en":                 task.PromptEn,
		"state":                     task.State,
		"submit_time":               task.SubmitTime,
		"start_time":                task.StartTime,
		"finish_time":               task.FinishTime,
		"image_url":                 task.ImageUrl,
		"video_url":                 task.VideoUrl,
		"video_urls":                task.VideoUrls,
		"properties":                task.Properties,
		"buttons":                   task.Buttons,
		"upstream_status":           upstreamStatus,
		"upstream_result_persisted": true,
		"price_snapshot_persisted":  true,
		"final_quota":               task.Quota,
		"final_quota_determined":    true,
		"billing_status":            billingStatus,
		"billing_last_error":        "",
		"fail_reason":               failReason,
		"status":                    "IN_PROGRESS",
		"progress":                  "99%",
	}, true); err != nil {
		return err
	}
	var reloaded model.Midjourney
	if err := model.DB.First(&reloaded, task.Id).Error; err != nil {
		return err
	}
	return ReconcileMidjourneyBilling(ctx, &reloaded)
}

func ReconcileMidjourneyBilling(ctx context.Context, task *model.Midjourney) error {
	if task == nil {
		return errors.New("midjourney task is nil")
	}
	if task.RequestId == nil || strings.TrimSpace(*task.RequestId) == "" {
		reason := "legacy midjourney task has no billing request id"
		_ = model.DB.Model(&model.Midjourney{}).Where("id = ?", task.Id).Updates(map[string]interface{}{
			"billing_status":     model.BillingRequestStatusManualReview,
			"billing_last_error": reason,
			"progress":           "99%",
		}).Error
		return model.ErrBillingRequestNotFound
	}
	requestID := strings.TrimSpace(*task.RequestId)
	operation := model.BillingJobOperationSettle
	targetQuota := task.FinalQuota
	if task.UpstreamStatus == "FAILURE" || task.UpstreamStatus == "CANCELLED" || task.UpstreamStatus == "EXPIRED" {
		operation = model.BillingJobOperationRefund
		targetQuota = 0
	} else if task.UpstreamStatus != "SUCCESS" {
		return nil
	}
	var err error
	if operation == model.BillingJobOperationSettle {
		_, err = model.SettleBillingRequest(requestID, targetQuota)
	} else {
		_, err = model.RefundBillingRequest(requestID)
	}
	if err != nil {
		if _, queueErr := model.QueueBillingJob(requestID, operation, targetQuota, err.Error()); queueErr != nil {
			_ = model.DB.Model(&model.Midjourney{}).Where("id = ?", task.Id).Updates(map[string]interface{}{
				"billing_status":     model.BillingRequestStatusManualReview,
				"billing_last_error": model.SanitizeBillingError(queueErr.Error()),
				"progress":           "99%",
			}).Error
			return fmt.Errorf("midjourney billing failed: %w; queue failed: %v", err, queueErr)
		}
		pendingStatus := model.BillingRequestStatusSettlementPending
		if operation == model.BillingJobOperationRefund {
			pendingStatus = model.BillingRequestStatusRefundPending
		}
		_ = model.DB.Model(&model.Midjourney{}).Where("id = ?", task.Id).Updates(map[string]interface{}{
			"billing_status":     pendingStatus,
			"billing_last_error": model.SanitizeBillingError(err.Error()),
			"progress":           "99%",
		}).Error
		return err
	}
	if err := model.SyncMidjourneyFromBillingRequest(task.Id); err != nil {
		return err
	}
	if operation == model.BillingJobOperationSettle {
		accounted, accountErr := model.AccountMidjourneyUsage(task.Id, targetQuota)
		if accountErr != nil {
			return accountErr
		}
		if accounted {
			model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{
				UserId:    task.UserId,
				LogType:   model.LogTypeConsume,
				Content:   "Midjourney 异步任务最终结算",
				ChannelId: task.ChannelId,
				ModelName: CovertMjpActionToModelName(task.Action),
				Quota:     int(targetQuota),
				Other: map[string]interface{}{
					"request_id": requestID,
					"task_id":    task.MjId,
				},
			})
		}
	}
	return nil
}
