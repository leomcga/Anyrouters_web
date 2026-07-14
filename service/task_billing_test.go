package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	common.SQLitePath = ":memory:"
	common.IsMasterNode = false
	common.UsingSQLite = true
	common.RedisEnabled = false
	common.BatchUpdateEnabled = false
	common.LogConsumeEnabled = true

	if err := model.InitDB(); err != nil {
		panic("failed to init test db: " + err.Error())
	}
	db := model.DB
	sqlDB, err := db.DB()
	if err != nil {
		panic("failed to get sql.DB: " + err.Error())
	}
	sqlDB.SetMaxOpenConns(1)

	model.LOG_DB = db

	if err := db.AutoMigrate(
		&model.Task{},
		&model.Midjourney{},
		&model.User{},
		&model.Token{},
		&model.Log{},
		&model.Channel{},
		&model.TopUp{},
		&model.UserSubscription{},
		&model.SubscriptionPreConsumeRecord{},
		&model.BillingRequest{},
		&model.BillingLedger{},
		&model.BillingJob{},
		&model.StripePaymentOrder{},
		&model.StripeWebhookEvent{},
		&model.PaymentCreditLedger{},
		&model.PaymentAudit{},
		&model.SandboxDailyUsage{},
		&model.SandboxExecution{},
	); err != nil {
		panic("failed to migrate: " + err.Error())
	}

	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

func truncate(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM tasks")
		model.DB.Exec("DELETE FROM midjourneys")
		model.DB.Exec("DELETE FROM users")
		model.DB.Exec("DELETE FROM tokens")
		model.DB.Exec("DELETE FROM logs")
		model.DB.Exec("DELETE FROM channels")
		model.DB.Exec("DELETE FROM top_ups")
		model.DB.Exec("DELETE FROM user_subscriptions")
		model.DB.Exec("DELETE FROM billing_jobs")
		model.DB.Exec("DELETE FROM billing_ledgers")
		model.DB.Exec("DELETE FROM billing_requests")
		model.DB.Exec("DELETE FROM sandbox_executions")
		model.DB.Exec("DELETE FROM sandbox_daily_usage")
		model.DB.Exec("DELETE FROM payment_audits")
		model.DB.Exec("DELETE FROM payment_credit_ledgers")
		model.DB.Exec("DELETE FROM stripe_webhook_events")
		model.DB.Exec("DELETE FROM stripe_payment_orders")
	})
}

func seedUser(t *testing.T, id int, quota int) {
	t.Helper()
	user := &model.User{Id: id, Username: fmt.Sprintf("test_user_%d", id), AffCode: fmt.Sprintf("aff_%d", id), Quota: quota, Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(user).Error)
}

func seedToken(t *testing.T, id int, userId int, key string, remainQuota int) {
	t.Helper()
	token := &model.Token{
		Id:          id,
		UserId:      userId,
		Key:         key,
		Name:        "test_token",
		Status:      common.TokenStatusEnabled,
		RemainQuota: remainQuota,
		UsedQuota:   0,
	}
	require.NoError(t, model.DB.Create(token).Error)
}

func seedSubscription(t *testing.T, id int, userId int, amountTotal int64, amountUsed int64) {
	t.Helper()
	sub := &model.UserSubscription{
		Id:          id,
		UserId:      userId,
		AmountTotal: amountTotal,
		AmountUsed:  amountUsed,
		Status:      "active",
		StartTime:   time.Now().Unix(),
		EndTime:     time.Now().Add(30 * 24 * time.Hour).Unix(),
	}
	require.NoError(t, model.DB.Create(sub).Error)
}

func seedChannel(t *testing.T, id int) {
	t.Helper()
	ch := &model.Channel{Id: id, Name: "test_channel", Key: "sk-test", Status: common.ChannelStatusEnabled}
	require.NoError(t, model.DB.Create(ch).Error)
}

var taskTestSequence atomic.Int64

func makeTask(userId, channelId, quota, tokenId int, billingSource string, subscriptionId int) *model.Task {
	sequence := taskTestSequence.Add(1)
	requestID := fmt.Sprintf("task-test-%d", sequence)
	task := &model.Task{
		TaskID:    fmt.Sprintf("task_test_%d", sequence),
		UserId:    userId,
		ChannelId: channelId,
		Quota:     quota,
		Status:    model.TaskStatus(model.TaskStatusInProgress),
		Group:     "default",
		Data:      json.RawMessage(`{}`),
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
		Properties: model.Properties{
			OriginModelName: "test-model",
		},
		PrivateData: model.TaskPrivateData{
			BillingSource:  billingSource,
			SubscriptionId: subscriptionId,
			TokenId:        tokenId,
			BillingContext: &model.TaskBillingContext{
				ModelPrice:      0.02,
				GroupRatio:      1.0,
				OriginModelName: "test-model",
			},
		},
	}
	params := model.BillingReserveParams{
		RequestID:      requestID,
		FundingSource:  billingSource,
		UserID:         userId,
		TokenID:        tokenId,
		SubscriptionID: subscriptionId,
		TargetQuota:    int64(quota),
		SkipToken:      tokenId == 0,
	}
	if tokenId > 0 {
		token, err := model.GetTokenById(tokenId)
		if err != nil {
			panic(err)
		}
		params.TokenKey = token.Key
	}
	if _, err := model.ReserveBillingRequest(params); err != nil {
		panic(err)
	}
	if err := model.BindAndInsertTask(task, requestID); err != nil {
		panic(err)
	}
	return task
}

// ---------------------------------------------------------------------------
// Read-back helpers
// ---------------------------------------------------------------------------

func getUserQuota(t *testing.T, id int) int {
	t.Helper()
	var user model.User
	require.NoError(t, model.DB.Select("quota").Where("id = ?", id).First(&user).Error)
	return user.Quota
}

func getTokenRemainQuota(t *testing.T, id int) int {
	t.Helper()
	var token model.Token
	require.NoError(t, model.DB.Select("remain_quota").Where("id = ?", id).First(&token).Error)
	return token.RemainQuota
}

func getTokenUsedQuota(t *testing.T, id int) int {
	t.Helper()
	var token model.Token
	require.NoError(t, model.DB.Select("used_quota").Where("id = ?", id).First(&token).Error)
	return token.UsedQuota
}

func getSubscriptionUsed(t *testing.T, id int) int64 {
	t.Helper()
	var sub model.UserSubscription
	require.NoError(t, model.DB.Select("amount_used").Where("id = ?", id).First(&sub).Error)
	return sub.AmountUsed
}

func getLastLog(t *testing.T) *model.Log {
	t.Helper()
	var log model.Log
	err := model.LOG_DB.Order("id desc").First(&log).Error
	if err != nil {
		return nil
	}
	return &log
}

func getLastBillingLedger(t *testing.T) *model.BillingLedger {
	t.Helper()
	var ledger model.BillingLedger
	if err := model.DB.Order("id desc").First(&ledger).Error; err != nil {
		return nil
	}
	return &ledger
}

func countLogs(t *testing.T) int64 {
	t.Helper()
	var count int64
	model.LOG_DB.Model(&model.Log{}).Count(&count)
	return count
}

func newRealtimeBillingContext(t *testing.T, userID, tokenID int, tokenKey string) (*gin.Context, *relaycommon.RelayInfo) {
	t.Helper()
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	relayInfo := &relaycommon.RelayInfo{
		RequestId:       "request-" + tokenKey,
		UserId:          userID,
		UserGroup:       "default",
		UsingGroup:      "default",
		TokenId:         tokenID,
		TokenKey:        tokenKey,
		OriginModelName: "gpt-4o",
		StartTime:       time.Now(),
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gpt-4o",
		},
		PriceData: types.PriceData{
			ModelRatio:      1.25,
			CompletionRatio: 4,
			GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
		},
	}
	return ctx, relayInfo
}

func realtimeTextInputUsage(textTokens int) *dto.RealtimeUsage {
	return &dto.RealtimeUsage{
		TotalTokens: textTokens,
		InputTokens: textTokens,
		InputTokenDetails: dto.InputTokenDetails{
			TextTokens: textTokens,
		},
	}
}

func TestRealtimeReserveThenSettleDoesNotDoubleCharge(t *testing.T) {
	truncate(t)
	ratio_setting.InitRatioSettings()

	const userID, tokenID = 40, 40
	const initQuota, initTokenQuota = 1000, 1000
	const preConsumed = 100
	const actualQuota = 300
	tokenKey := "rt-no-double"

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, tokenKey, initTokenQuota)

	ctx, relayInfo := newRealtimeBillingContext(t, userID, tokenID, tokenKey)
	apiErr := PreConsumeBilling(ctx, preConsumed, relayInfo)
	require.Nil(t, apiErr)

	// gpt-4o input price is modelRatio=1.25, so 240 text input tokens => 300 quota.
	require.NoError(t, PreWssConsumeQuota(ctx, relayInfo, realtimeTextInputUsage(240)))

	assert.Equal(t, initQuota-actualQuota, getUserQuota(t, userID))
	assert.Equal(t, initTokenQuota-actualQuota, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, actualQuota, relayInfo.FinalPreConsumedQuota)

	PostWssConsumeQuota(ctx, relayInfo, relayInfo.UpstreamModelName, realtimeTextInputUsage(240), "")

	assert.Equal(t, initQuota-actualQuota, getUserQuota(t, userID))
	assert.Equal(t, initTokenQuota-actualQuota, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, actualQuota, getTokenUsedQuota(t, tokenID))
}

func TestRealtimeWalletAlwaysPreConsumesBeforeReserve(t *testing.T) {
	truncate(t)
	ratio_setting.InitRatioSettings()

	const userID, tokenID = 42, 42
	const initQuota, initTokenQuota = 6000000, 6000000
	const preConsumed = 100
	const actualQuota = 300
	tokenKey := "rt-trusted-reserve"

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, tokenKey, initTokenQuota)

	ctx, relayInfo := newRealtimeBillingContext(t, userID, tokenID, tokenKey)
	ctx.Set("token_quota", initTokenQuota)
	apiErr := PreConsumeBilling(ctx, preConsumed, relayInfo)
	require.Nil(t, apiErr)

	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID))
	assert.Equal(t, initTokenQuota-preConsumed, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, preConsumed, relayInfo.FinalPreConsumedQuota)

	// Wallet requests always pre-consume first, then atomically reserve only the
	// additional cumulative usage while the websocket is open.
	require.NoError(t, PreWssConsumeQuota(ctx, relayInfo, realtimeTextInputUsage(240)))

	assert.Equal(t, initQuota-actualQuota, getUserQuota(t, userID))
	assert.Equal(t, initTokenQuota-actualQuota, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, actualQuota, relayInfo.FinalPreConsumedQuota)

	PostWssConsumeQuota(ctx, relayInfo, relayInfo.UpstreamModelName, realtimeTextInputUsage(240), "")

	assert.Equal(t, initQuota-actualQuota, getUserQuota(t, userID))
	assert.Equal(t, initTokenQuota-actualQuota, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, actualQuota, getTokenUsedQuota(t, tokenID))
}

func TestRealtimeSettleRefundsOverReservedQuota(t *testing.T) {
	truncate(t)
	ratio_setting.InitRatioSettings()

	const userID, tokenID = 41, 41
	const initQuota, initTokenQuota = 1000, 1000
	const preConsumed = 300
	const actualQuota = 100
	tokenKey := "rt-refund"

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, tokenKey, initTokenQuota)

	ctx, relayInfo := newRealtimeBillingContext(t, userID, tokenID, tokenKey)
	apiErr := PreConsumeBilling(ctx, preConsumed, relayInfo)
	require.Nil(t, apiErr)

	// 80 * 1.25 = 100 quota. No extra reserve should happen.
	require.NoError(t, PreWssConsumeQuota(ctx, relayInfo, realtimeTextInputUsage(80)))
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID))
	assert.Equal(t, initTokenQuota-preConsumed, getTokenRemainQuota(t, tokenID))

	PostWssConsumeQuota(ctx, relayInfo, relayInfo.UpstreamModelName, realtimeTextInputUsage(80), "")

	assert.Equal(t, initQuota-actualQuota, getUserQuota(t, userID))
	assert.Equal(t, initTokenQuota-actualQuota, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, actualQuota, getTokenUsedQuota(t, tokenID))
}

func TestUnlimitedTokenSettlementKeepsRemainQuota(t *testing.T) {
	for _, tc := range []struct {
		name        string
		actualQuota int
	}{
		{name: "refund difference", actualQuota: 60},
		{name: "charge difference", actualQuota: 140},
	} {
		t.Run(tc.name, func(t *testing.T) {
			truncate(t)

			const userID, tokenID = 43, 43
			const initQuota, preConsumed = 1000, 100
			tokenKey := "unlimited-settle-" + tc.name
			seedUser(t, userID, initQuota)
			seedToken(t, tokenID, userID, tokenKey, 0)
			require.NoError(t, model.DB.Model(&model.Token{}).
				Where("id = ?", tokenID).
				Update("unlimited_quota", true).Error)

			ctx, relayInfo := newRealtimeBillingContext(t, userID, tokenID, tokenKey)
			relayInfo.TokenUnlimited = true
			apiErr := PreConsumeBilling(ctx, preConsumed, relayInfo)
			require.Nil(t, apiErr)
			assert.Equal(t, 0, getTokenRemainQuota(t, tokenID))
			assert.Equal(t, preConsumed, getTokenUsedQuota(t, tokenID))

			require.NoError(t, relayInfo.Billing.Settle(tc.actualQuota))
			assert.Equal(t, initQuota-tc.actualQuota, getUserQuota(t, userID))
			assert.Equal(t, 0, getTokenRemainQuota(t, tokenID))
			assert.Equal(t, tc.actualQuota, getTokenUsedQuota(t, tokenID))
		})
	}
}

func TestUnlimitedTokenRefundKeepsRemainQuota(t *testing.T) {
	truncate(t)

	const userID, tokenID = 44, 44
	const initQuota, preConsumed = 1000, 100
	tokenKey := "unlimited-refund"
	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, tokenKey, 0)
	require.NoError(t, model.DB.Model(&model.Token{}).
		Where("id = ?", tokenID).
		Update("unlimited_quota", true).Error)

	ctx, relayInfo := newRealtimeBillingContext(t, userID, tokenID, tokenKey)
	relayInfo.TokenUnlimited = true
	apiErr := PreConsumeBilling(ctx, preConsumed, relayInfo)
	require.Nil(t, apiErr)

	relayInfo.Billing.Refund(ctx)
	require.Eventually(t, func() bool {
		return getUserQuota(t, userID) == initQuota &&
			getTokenRemainQuota(t, tokenID) == 0 &&
			getTokenUsedQuota(t, tokenID) == 0
	}, time.Second, 10*time.Millisecond)
}

// ===========================================================================
// RefundTaskQuota tests
// ===========================================================================

func TestRefundTaskQuota_Wallet(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 1, 1, 1
	const initQuota, preConsumed = 10000, 3000
	const tokenRemain = 5000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-test-key", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)

	RefundTaskQuota(ctx, task, "task failed: upstream error")

	// User quota should increase by preConsumed
	assert.Equal(t, initQuota, getUserQuota(t, userID))

	// Token remain_quota should increase, used_quota should decrease
	assert.Equal(t, tokenRemain, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, 0, getTokenUsedQuota(t, tokenID))

	// A refund log should be created
	ledger := getLastBillingLedger(t)
	require.NotNil(t, ledger)
	assert.Equal(t, model.BillingOperationRefund, ledger.Operation)
	assert.Equal(t, int64(-preConsumed), ledger.Amount)
}

func TestRefundTaskQuota_Subscription(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID, subID = 2, 2, 2, 1
	const preConsumed = 2000
	const subTotal, subUsed int64 = 100000, 50000
	const tokenRemain = 8000

	seedUser(t, userID, 0)
	seedToken(t, tokenID, userID, "sk-sub-key", tokenRemain)
	seedChannel(t, channelID)
	seedSubscription(t, subID, userID, subTotal, subUsed)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceSubscription, subID)

	RefundTaskQuota(ctx, task, "subscription task failed")

	// Subscription used should decrease by preConsumed
	assert.Equal(t, subUsed, getSubscriptionUsed(t, subID))

	// Token should also be refunded
	assert.Equal(t, tokenRemain, getTokenRemainQuota(t, tokenID))

	ledger := getLastBillingLedger(t)
	require.NotNil(t, ledger)
	assert.Equal(t, model.BillingOperationRefund, ledger.Operation)
}

func TestRefundTaskQuota_ZeroQuota(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID = 3
	seedUser(t, userID, 5000)

	task := makeTask(userID, 0, 0, 0, BillingSourceWallet, 0)

	RefundTaskQuota(ctx, task, "zero quota task")

	// No change to user quota
	assert.Equal(t, 5000, getUserQuota(t, userID))

	// No log created
	assert.Equal(t, int64(0), countLogs(t))
}

func TestRefundTaskQuota_NoToken(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, channelID = 4, 4
	const initQuota, preConsumed = 10000, 1500

	seedUser(t, userID, initQuota)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, 0, BillingSourceWallet, 0) // TokenId=0

	RefundTaskQuota(ctx, task, "no token task failed")

	// User quota refunded
	assert.Equal(t, initQuota, getUserQuota(t, userID))

	// Log created
	ledger := getLastBillingLedger(t)
	require.NotNil(t, ledger)
	assert.Equal(t, model.BillingOperationRefund, ledger.Operation)
}

// ===========================================================================
// RecalculateTaskQuota tests
// ===========================================================================

func TestRecalculate_PositiveDelta(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 10, 10, 10
	const initQuota, preConsumed = 10000, 2000
	const actualQuota = 3000 // under-charged by 1000
	const tokenRemain = 5000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-recalc-pos", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)

	RecalculateTaskQuota(ctx, task, actualQuota, "adaptor adjustment")

	// User quota should decrease by the delta (1000 additional charge)
	assert.Equal(t, initQuota-actualQuota, getUserQuota(t, userID))

	// Token should also be charged the delta
	assert.Equal(t, tokenRemain-actualQuota, getTokenRemainQuota(t, tokenID))

	assert.Equal(t, actualQuota, task.Quota)

	// Log type should be Consume (additional charge)
	ledger := getLastBillingLedger(t)
	require.NotNil(t, ledger)
	assert.Equal(t, model.BillingOperationSettle, ledger.Operation)
	assert.Equal(t, int64(actualQuota-preConsumed), ledger.Amount)
}

func TestRecalculate_NegativeDelta(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 11, 11, 11
	const initQuota, preConsumed = 10000, 5000
	const actualQuota = 3000 // over-charged by 2000
	const tokenRemain = 5000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-recalc-neg", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)

	RecalculateTaskQuota(ctx, task, actualQuota, "adaptor adjustment")

	// User quota should increase by abs(delta) = 2000 (refund overpayment)
	assert.Equal(t, initQuota-actualQuota, getUserQuota(t, userID))

	// Token should be refunded the difference
	assert.Equal(t, tokenRemain-actualQuota, getTokenRemainQuota(t, tokenID))

	// task.Quota updated
	assert.Equal(t, actualQuota, task.Quota)

	// Log type should be Refund
	ledger := getLastBillingLedger(t)
	require.NotNil(t, ledger)
	assert.Equal(t, model.BillingOperationSettle, ledger.Operation)
	assert.Equal(t, int64(actualQuota-preConsumed), ledger.Amount)
}

func TestRecalculate_ZeroDelta(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID = 12
	const initQuota, preConsumed = 10000, 3000

	seedUser(t, userID, initQuota)

	task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)

	RecalculateTaskQuota(ctx, task, preConsumed, "exact match")

	// No change to user quota
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID))

	// No log created (delta is zero)
	assert.Equal(t, int64(0), countLogs(t))
}

func TestRecalculate_ActualQuotaZero(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID = 13
	const initQuota = 10000

	seedUser(t, userID, initQuota)

	task := makeTask(userID, 0, 5000, 0, BillingSourceWallet, 0)

	RecalculateTaskQuota(ctx, task, 0, "zero actual")

	// Explicit zero settles to zero and returns the full reservation.
	assert.Equal(t, initQuota, getUserQuota(t, userID))
	assert.Equal(t, int64(0), countLogs(t))
}

func TestRecalculateTaskQuotaByTokensUsesBillingSnapshot(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID = 130
	const initQuota = 10000
	const totalTokens = 100
	const expectedQuota = 400

	seedUser(t, userID, initQuota)

	task := makeTask(userID, 0, 100, 0, BillingSourceWallet, 0)
	task.Properties.OriginModelName = "gpt-4"
	task.PrivateData.BillingContext.ModelRatio = 2
	task.PrivateData.BillingContext.GroupRatio = 0.5
	task.PrivateData.BillingContext.OtherRatios = map[string]float64{
		"seconds": 4,
	}

	RecalculateTaskQuotaByTokens(ctx, task, totalTokens)

	assert.Equal(t, expectedQuota, task.Quota)
	assert.Equal(t, initQuota-expectedQuota, getUserQuota(t, userID))
}

func TestRecalculateTaskQuotaByTokensSkipsPerCallBilling(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID = 131
	const initQuota = 10000
	const preConsumed = 300

	seedUser(t, userID, initQuota)

	task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)
	task.Properties.OriginModelName = "gpt-4"
	task.PrivateData.BillingContext.PerCallBilling = true

	RecalculateTaskQuotaByTokens(ctx, task, 100)

	assert.Equal(t, preConsumed, task.Quota)
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID))
	assert.Equal(t, int64(0), countLogs(t))
}

func TestRecalculate_Subscription_NegativeDelta(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID, subID = 14, 14, 14, 2
	const preConsumed = 5000
	const actualQuota = 2000 // over-charged by 3000
	const subTotal, subUsed int64 = 100000, 50000
	const tokenRemain = 8000

	seedUser(t, userID, 0)
	seedToken(t, tokenID, userID, "sk-sub-recalc", tokenRemain)
	seedChannel(t, channelID)
	seedSubscription(t, subID, userID, subTotal, subUsed)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceSubscription, subID)

	RecalculateTaskQuota(ctx, task, actualQuota, "subscription over-charge")

	// Subscription used should decrease by delta (refund 3000)
	assert.Equal(t, subUsed+int64(actualQuota), getSubscriptionUsed(t, subID))

	// Token refunded
	assert.Equal(t, tokenRemain-actualQuota, getTokenRemainQuota(t, tokenID))

	assert.Equal(t, actualQuota, task.Quota)

	ledger := getLastBillingLedger(t)
	require.NotNil(t, ledger)
	assert.Equal(t, model.BillingOperationSettle, ledger.Operation)
}

// ===========================================================================
// CAS + Billing integration tests
// Simulates the flow in updateVideoSingleTask (service/task_polling.go)
// ===========================================================================

// simulatePollBilling reproduces the CAS + billing logic from updateVideoSingleTask.
// It takes a persisted task (already in DB), applies the new status, and performs
// the conditional update + billing exactly as the polling loop does.
func simulatePollBilling(ctx context.Context, task *model.Task, newStatus model.TaskStatus, actualQuota int) {
	if newStatus == model.TaskStatusSuccess || newStatus == model.TaskStatusFailure {
		claimed, err := model.ClaimTask(task.ID, "test-poller", time.Now(), time.Minute)
		if err != nil {
			return
		}
		input := TaskTerminalBillingInput{
			UpstreamStatus: newStatus,
			FinalQuota:     int64(actualQuota),
			FinishTime:     9999,
		}
		if newStatus == model.TaskStatusSuccess {
			input.UsageAvailable = true
			input.UsageBasis = "test_actual_quota"
		}
		if newStatus == model.TaskStatusFailure {
			input.FailReason = "upstream error"
		}
		_ = PersistAndFinalizeTaskBilling(ctx, claimed, "test-poller", input)
		return
	}
	snap := task.Snapshot()
	task.Status = newStatus
	task.UpstreamStatus = newStatus
	task.Progress = "50%"
	if !snap.Equal(task.Snapshot()) {
		_, _ = task.UpdateWithStatus(snap.Status)
	}
}

func TestCASGuardedRefund_Win(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 20, 20, 20
	const initQuota, preConsumed = 10000, 4000
	const tokenRemain = 6000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-cas-refund-win", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatus(model.TaskStatusInProgress)

	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusFailure), 0)

	// CAS wins: task in DB should now be FAILURE
	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusFailure, reloaded.Status)

	// Refund should have happened
	assert.Equal(t, initQuota, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain, getTokenRemainQuota(t, tokenID))

	ledger := getLastBillingLedger(t)
	require.NotNil(t, ledger)
	assert.Equal(t, model.BillingOperationRefund, ledger.Operation)
}

func TestCASGuardedRefund_Lose(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 21, 21, 21
	const initQuota, preConsumed = 10000, 4000
	const tokenRemain = 6000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-cas-refund-lose", tokenRemain)
	seedChannel(t, channelID)

	// Create task with IN_PROGRESS in DB
	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatus(model.TaskStatusInProgress)

	// Simulate another process already transitioning to FAILURE
	_, claimErr := model.ClaimTask(task.ID, "other-poller", time.Now(), time.Minute)
	require.NoError(t, claimErr)

	// Our process still has the old in-memory state (IN_PROGRESS) and tries to transition
	// task.Status is still IN_PROGRESS in the snapshot
	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusFailure), 0)

	// CAS lost: user quota should NOT change (no double refund)
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain-preConsumed, getTokenRemainQuota(t, tokenID))

	// No billing log should be created
	assert.Equal(t, int64(0), countLogs(t))
}

func TestCASGuardedSettle_Win(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 22, 22, 22
	const initQuota, preConsumed = 10000, 5000
	const actualQuota = 3000 // over-charged, should get partial refund
	const tokenRemain = 8000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-cas-settle-win", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatus(model.TaskStatusInProgress)

	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusSuccess), actualQuota)

	// CAS wins: task should be SUCCESS
	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusSuccess, reloaded.Status)

	// Settlement should refund the over-charge (5000 - 3000 = 2000 back to user)
	assert.Equal(t, initQuota-actualQuota, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain-actualQuota, getTokenRemainQuota(t, tokenID))

	// Persisted task quota is the financial source used by subsequent reads.
	assert.Equal(t, actualQuota, reloaded.Quota)
}

func TestNonTerminalUpdate_NoBilling(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, channelID = 23, 23
	const initQuota, preConsumed = 10000, 3000

	seedUser(t, userID, initQuota)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, 0, BillingSourceWallet, 0)
	task.Status = model.TaskStatus(model.TaskStatusInProgress)
	task.Progress = "20%"

	// Simulate a non-terminal poll update (still IN_PROGRESS, progress changed)
	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusInProgress), 0)

	// User quota should NOT change
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID))

	// No billing log
	assert.Equal(t, int64(0), countLogs(t))

	// Task progress should be updated in DB
	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.Equal(t, "50%", reloaded.Progress)
}

// ===========================================================================
// Mock adaptor for settleTaskBillingOnComplete tests
// ===========================================================================

type mockAdaptor struct {
	adjustReturn int
}

func (m *mockAdaptor) Init(_ *relaycommon.RelayInfo) {}
func (m *mockAdaptor) FetchTask(string, string, map[string]any, string) (*http.Response, error) {
	return nil, nil
}
func (m *mockAdaptor) ParseTaskResult([]byte) (*relaycommon.TaskInfo, error) { return nil, nil }
func (m *mockAdaptor) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return m.adjustReturn
}

// ===========================================================================
// PerCallBilling tests — settleTaskBillingOnComplete
// ===========================================================================

func TestSettle_PerCallBilling_SkipsAdaptorAdjust(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 30, 30, 30
	const initQuota, preConsumed = 10000, 5000
	const tokenRemain = 8000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-percall-adaptor", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.PerCallBilling = true

	adaptor := &mockAdaptor{adjustReturn: 2000}
	taskResult := &relaycommon.TaskInfo{Status: model.TaskStatusSuccess}

	settleTaskBillingOnComplete(ctx, adaptor, task, taskResult)

	// Per-call: no adjustment despite adaptor returning 2000
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain-preConsumed, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, preConsumed, task.Quota)
	assert.Equal(t, int64(0), countLogs(t))
}

func TestSettle_PerCallBilling_SkipsTotalTokens(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 31, 31, 31
	const initQuota, preConsumed = 10000, 4000
	const tokenRemain = 7000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-percall-tokens", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.PerCallBilling = true

	adaptor := &mockAdaptor{adjustReturn: 0}
	taskResult := &relaycommon.TaskInfo{Status: model.TaskStatusSuccess, TotalTokens: 9999}

	settleTaskBillingOnComplete(ctx, adaptor, task, taskResult)

	// Per-call: no recalculation by tokens
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain-preConsumed, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, preConsumed, task.Quota)
	assert.Equal(t, int64(0), countLogs(t))
}

func TestSettle_NonPerCall_AdaptorAdjustWorks(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 32, 32, 32
	const initQuota, preConsumed = 10000, 5000
	const adaptorQuota = 3000
	const tokenRemain = 8000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-nonpercall-adj", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	// PerCallBilling defaults to false

	adaptor := &mockAdaptor{adjustReturn: adaptorQuota}
	taskResult := &relaycommon.TaskInfo{Status: model.TaskStatusSuccess}

	settleTaskBillingOnComplete(ctx, adaptor, task, taskResult)

	// Non-per-call: adaptor adjustment applies (refund 2000)
	assert.Equal(t, initQuota-adaptorQuota, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain-adaptorQuota, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, adaptorQuota, task.Quota)

	ledger := getLastBillingLedger(t)
	require.NotNil(t, ledger)
	assert.Equal(t, model.BillingOperationSettle, ledger.Operation)
}
