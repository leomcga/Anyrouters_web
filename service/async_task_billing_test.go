package service

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskSettlementRecoversAfterTerminalPersistenceCrash(t *testing.T) {
	truncate(t)
	seedUser(t, 201, 1000)
	task := makeTask(201, 0, 300, 0, BillingSourceWallet, 0)

	claimed, err := model.ClaimTask(task.ID, "crashed-poller", time.Now(), time.Minute)
	require.NoError(t, err)
	require.NoError(t, model.UpdateClaimedTask(claimed, "crashed-poller", map[string]interface{}{
		"upstream_status":           model.TaskStatusSuccess,
		"upstream_result_persisted": true,
		"price_snapshot_persisted":  true,
		"usage_estimated":           true,
		"usage_basis":               "reserved_quota_no_usage",
		"final_quota":               int64(300),
		"final_quota_determined":    true,
		"billing_status":            model.BillingRequestStatusSettlementPending,
		"status":                    model.TaskStatusInProgress,
		"progress":                  "99%",
	}, true))

	assert.Equal(t, 700, getUserQuota(t, 201))
	var pending model.Task
	require.NoError(t, model.DB.First(&pending, task.ID).Error)
	require.NoError(t, ReconcileTaskBilling(context.Background(), &pending))
	assert.Equal(t, 700, getUserQuota(t, 201))

	var completed model.Task
	require.NoError(t, model.DB.First(&completed, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusSuccess, completed.Status)
	assert.Equal(t, "100%", completed.Progress)
	assert.Equal(t, model.BillingRequestStatusSettled, completed.BillingStatus)
}

func TestTaskRefundRecoversAfterTerminalPersistenceCrash(t *testing.T) {
	truncate(t)
	seedUser(t, 202, 1000)
	task := makeTask(202, 0, 300, 0, BillingSourceWallet, 0)

	claimed, err := model.ClaimTask(task.ID, "crashed-poller", time.Now(), time.Minute)
	require.NoError(t, err)
	require.NoError(t, model.UpdateClaimedTask(claimed, "crashed-poller", map[string]interface{}{
		"upstream_status":           model.TaskStatusFailure,
		"upstream_result_persisted": true,
		"billing_status":            model.BillingRequestStatusRefundPending,
		"status":                    model.TaskStatusInProgress,
		"progress":                  "99%",
	}, true))

	var pending model.Task
	require.NoError(t, model.DB.First(&pending, task.ID).Error)
	require.NoError(t, ReconcileTaskBilling(context.Background(), &pending))
	assert.Equal(t, 1000, getUserQuota(t, 202))

	var completed model.Task
	require.NoError(t, model.DB.First(&completed, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusFailure, completed.Status)
	assert.Equal(t, model.BillingRequestStatusRefunded, completed.BillingStatus)
}

func TestTaskTerminalReplayTwentyTimesIsIdempotent(t *testing.T) {
	for _, upstreamStatus := range []model.TaskStatus{model.TaskStatusSuccess, model.TaskStatusFailure} {
		t.Run(string(upstreamStatus), func(t *testing.T) {
			truncate(t)
			userID := 203
			seedUser(t, userID, 1000)
			task := makeTask(userID, 0, 300, 0, BillingSourceWallet, 0)
			claimed, err := model.ClaimTask(task.ID, "first-poller", time.Now(), time.Minute)
			require.NoError(t, err)
			require.NoError(t, PersistAndFinalizeTaskBilling(context.Background(), claimed, "first-poller", TaskTerminalBillingInput{
				UpstreamStatus: upstreamStatus,
				FinalQuota:     250,
				UsageAvailable: upstreamStatus == model.TaskStatusSuccess,
				UsageTotal:     10,
				UsageBasis:     "test",
			}))

			for i := 0; i < 20; i++ {
				var replay model.Task
				require.NoError(t, model.DB.First(&replay, task.ID).Error)
				require.NoError(t, ReconcileTaskBilling(context.Background(), &replay))
			}
			expected := 750
			operation := model.BillingOperationSettle
			if upstreamStatus == model.TaskStatusFailure {
				expected = 1000
				operation = model.BillingOperationRefund
			}
			assert.Equal(t, expected, getUserQuota(t, userID))
			var terminalLedgers int64
			require.NoError(t, model.DB.Model(&model.BillingLedger{}).
				Where("request_id = ? AND operation = ?", *task.RequestId, operation).
				Count(&terminalLedgers).Error)
			assert.EqualValues(t, 1, terminalLedgers)
			var user model.User
			require.NoError(t, model.DB.Select("used_quota", "request_count").First(&user, userID).Error)
			if upstreamStatus == model.TaskStatusSuccess {
				assert.Equal(t, 250, user.UsedQuota)
				assert.Equal(t, 1, user.RequestCount)
				assert.EqualValues(t, 1, countLogs(t))
			} else {
				assert.Zero(t, user.UsedQuota)
				assert.Zero(t, user.RequestCount)
				assert.Zero(t, countLogs(t))
			}
		})
	}
}

func TestTaskLeaseSingleWinnerAndExpiryTakeover(t *testing.T) {
	truncate(t)
	seedUser(t, 204, 1000)
	task := makeTask(204, 0, 100, 0, BillingSourceWallet, 0)
	now := time.Now()

	first, err := model.ClaimTask(task.ID, "worker-one", now, time.Minute)
	require.NoError(t, err)
	require.NotNil(t, first)
	_, err = model.ClaimTask(task.ID, "worker-two", now, time.Minute)
	assert.ErrorIs(t, err, model.ErrTaskLeaseConflict)

	second, err := model.ClaimTask(task.ID, "worker-two", now.Add(2*time.Minute), time.Minute)
	require.NoError(t, err)
	assert.Equal(t, "worker-two", second.LockedBy)
}

func TestTaskBillingIdentityConflicts(t *testing.T) {
	truncate(t)
	seedUser(t, 205, 1000)
	first := makeTask(205, 0, 100, 0, BillingSourceWallet, 0)

	_, err := model.ReserveBillingRequest(model.BillingReserveParams{
		RequestID:     "task-conflict-second",
		FundingSource: model.BillingFundingSourceWallet,
		UserID:        205,
		TargetQuota:   100,
		SkipToken:     true,
	})
	require.NoError(t, err)
	sameTaskID := &model.Task{TaskID: first.TaskID, UserId: 205, Quota: 100}
	assert.ErrorIs(t, model.BindAndInsertTask(sameTaskID, "task-conflict-second"), model.ErrTaskBillingConflict)

	differentTaskID := &model.Task{TaskID: "different-task-id", UserId: 205, Quota: 100}
	assert.ErrorIs(t, model.BindAndInsertTask(differentTaskID, *first.RequestId), model.ErrTaskBillingConflict)
}

func TestTaskMissingUsageUsesReservedSnapshot(t *testing.T) {
	truncate(t)
	seedUser(t, 206, 1000)
	task := makeTask(206, 0, 300, 0, BillingSourceWallet, 0)
	claimed, err := model.ClaimTask(task.ID, "usage-poller", time.Now(), time.Minute)
	require.NoError(t, err)
	require.NoError(t, PersistAndFinalizeTaskBilling(context.Background(), claimed, "usage-poller", TaskTerminalBillingInput{
		UpstreamStatus: model.TaskStatusSuccess,
	}))

	var waiting model.Task
	require.NoError(t, model.DB.First(&waiting, task.ID).Error)
	assert.Equal(t, "waiting_for_usage", waiting.UsageBasis)
	assert.False(t, waiting.FinalQuotaDetermined)
	assert.Equal(t, "99%", waiting.Progress)
	require.NoError(t, model.DB.Model(&model.Task{}).Where("id = ?", task.ID).
		Update("usage_wait_until", time.Now().Add(-time.Second).Unix()).Error)
	require.NoError(t, model.DB.First(&waiting, task.ID).Error)
	require.NoError(t, ReconcileTaskBilling(context.Background(), &waiting))

	var completed model.Task
	require.NoError(t, model.DB.First(&completed, task.ID).Error)
	assert.True(t, completed.UsageEstimated)
	assert.Equal(t, "reserved_quota_no_usage", completed.UsageBasis)
	assert.EqualValues(t, 300, completed.FinalQuota)
	assert.Equal(t, 700, getUserQuota(t, 206))
}

func TestTaskDelayedUsageSettlesFromPriceSnapshot(t *testing.T) {
	truncate(t)
	seedUser(t, 210, 1000)
	task := makeTask(210, 0, 300, 0, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.ModelRatio = 2
	task.PrivateData.BillingContext.GroupRatio = 1
	require.NoError(t, model.DB.Model(&model.Task{}).Where("id = ?", task.ID).
		Update("private_data", task.PrivateData).Error)

	claimed, err := model.ClaimTask(task.ID, "delayed-usage-worker", time.Now(), time.Minute)
	require.NoError(t, err)
	require.NoError(t, PersistAndFinalizeTaskBilling(context.Background(), claimed, "delayed-usage-worker", TaskTerminalBillingInput{
		UpstreamStatus: model.TaskStatusSuccess,
	}))
	assert.Equal(t, 700, getUserQuota(t, 210))

	var waiting model.Task
	require.NoError(t, model.DB.First(&waiting, task.ID).Error)
	assert.Equal(t, "waiting_for_usage", waiting.UsageBasis)
	finalQuota, ok := CalculateTaskQuotaByTokens(&waiting, 100)
	require.True(t, ok)
	assert.EqualValues(t, 200, finalQuota)

	claimed, err = model.ClaimTask(task.ID, "delayed-usage-worker", time.Now(), time.Minute)
	require.NoError(t, err)
	require.NoError(t, PersistAndFinalizeTaskBilling(context.Background(), claimed, "delayed-usage-worker", TaskTerminalBillingInput{
		UpstreamStatus: model.TaskStatusSuccess,
		FinalQuota:     finalQuota,
		UsageTotal:     100,
		UsageAvailable: true,
		UsageBasis:     "token_usage_snapshot",
	}))
	assert.Equal(t, 800, getUserQuota(t, 210))
	var completed model.Task
	require.NoError(t, model.DB.First(&completed, task.ID).Error)
	assert.False(t, completed.UsageEstimated)
	assert.Equal(t, "token_usage_snapshot", completed.UsageBasis)
	assert.Equal(t, model.BillingRequestStatusSettled, completed.BillingStatus)
}

func TestTaskCancelledAndExpiredRefundReservations(t *testing.T) {
	for index, status := range []model.TaskStatus{model.TaskStatusCancelled, model.TaskStatusExpired} {
		t.Run(string(status), func(t *testing.T) {
			truncate(t)
			userID := 220 + index
			seedUser(t, userID, 1000)
			task := makeTask(userID, 0, 200, 0, BillingSourceWallet, 0)
			claimed, err := model.ClaimTask(task.ID, "terminal-worker", time.Now(), time.Minute)
			require.NoError(t, err)
			require.NoError(t, PersistAndFinalizeTaskBilling(context.Background(), claimed, "terminal-worker", TaskTerminalBillingInput{
				UpstreamStatus: status,
				FailReason:     "terminal without success",
			}))
			assert.Equal(t, 1000, getUserQuota(t, userID))
			var completed model.Task
			require.NoError(t, model.DB.First(&completed, task.ID).Error)
			assert.Equal(t, status, completed.UpstreamStatus)
			assert.EqualValues(t, model.TaskStatusFailure, completed.Status)
			assert.Equal(t, model.BillingRequestStatusRefunded, completed.BillingStatus)
		})
	}
}

func TestMidjourneyTerminalBillingUsesBoundRequest(t *testing.T) {
	truncate(t)
	seedUser(t, 209, 1000)
	_, err := model.ReserveBillingRequest(model.BillingReserveParams{
		RequestID:     "midjourney-bound-request",
		FundingSource: model.BillingFundingSourceWallet,
		UserID:        209,
		TargetQuota:   200,
		SkipToken:     true,
	})
	require.NoError(t, err)
	task := &model.Midjourney{
		UserId:          209,
		MjId:            "mj-upstream-209",
		Status:          "IN_PROGRESS",
		Progress:        "50%",
		Quota:           200,
		BillingSnapshot: `{"model":"midjourney","quota":200}`,
		SubmitAttempt:   1,
	}
	require.NoError(t, model.BindAndInsertMidjourneyTask(task, "midjourney-bound-request"))
	claimed, err := model.ClaimMidjourneyTask(task.Id, "mj-worker", time.Now(), time.Minute)
	require.NoError(t, err)
	require.NoError(t, PersistAndFinalizeMidjourneyBilling(context.Background(), claimed, "mj-worker", "SUCCESS", ""))
	assert.Equal(t, 800, getUserQuota(t, 209))

	var completed model.Midjourney
	require.NoError(t, model.DB.First(&completed, task.Id).Error)
	assert.Equal(t, "SUCCESS", completed.Status)
	assert.Equal(t, model.BillingRequestStatusSettled, completed.BillingStatus)
	assert.True(t, completed.PriceSnapshotPersisted)
}

func sandboxContext(requestID string) *gin.Context {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/pg/execute", nil)
	ctx.Set(common.RequestIdKey, requestID)
	return ctx
}

func TestSandboxFreePaidFailureAndRecovery(t *testing.T) {
	truncate(t)
	t.Setenv("SANDBOX_BILLING_ENABLED", "true")
	t.Setenv("SANDBOX_FREE_DAILY", "1")
	t.Setenv("SANDBOX_EXEC_QUOTA", "100")
	seedUser(t, 207, 1000)

	free, err := PrepareSandboxExecution(sandboxContext("sandbox-free"), 207)
	require.NoError(t, err)
	assert.True(t, free.IsFree)
	require.NoError(t, CompleteSandboxExecution(context.Background(), free))
	assert.Equal(t, 1000, getUserQuota(t, 207))

	paid, err := PrepareSandboxExecution(sandboxContext("sandbox-paid"), 207)
	require.NoError(t, err)
	assert.False(t, paid.IsFree)
	assert.Equal(t, 900, getUserQuota(t, 207))
	require.NoError(t, CompleteSandboxExecution(context.Background(), paid))
	assert.Equal(t, 900, getUserQuota(t, 207))

	failed, err := PrepareSandboxExecution(sandboxContext("sandbox-failed"), 207)
	require.NoError(t, err)
	assert.Equal(t, 800, getUserQuota(t, 207))
	require.NoError(t, FailSandboxExecution(context.Background(), failed))
	assert.Equal(t, 900, getUserQuota(t, 207))

	stale, err := PrepareSandboxExecution(sandboxContext("sandbox-stale"), 207)
	require.NoError(t, err)
	assert.Equal(t, 800, getUserQuota(t, 207))
	require.NoError(t, model.DB.Model(&model.SandboxExecution{}).
		Where("request_id = ?", stale.RequestID).
		Update("created_at", time.Now().Add(-10*time.Minute).Unix()).Error)
	recovered, err := RecoverStaleSandboxExecutions(context.Background(), time.Now().Add(-5*time.Minute).Unix(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, recovered)
	assert.Equal(t, 900, getUserQuota(t, 207))

	t.Setenv("SANDBOX_FREE_DAILY", "0")
	seedUser(t, 208, 50)
	_, err = PrepareSandboxExecution(sandboxContext("sandbox-insufficient"), 208)
	assert.True(t, errors.Is(err, ErrSandboxQuotaInsufficient))
}
