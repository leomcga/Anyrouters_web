package model

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetBillingFixtures(t *testing.T) {
	t.Helper()
	for _, trigger := range []string{
		"fail_token_update",
		"fail_billing_ledger_insert",
		"fail_billing_request_update",
	} {
		require.NoError(t, DB.Exec("DROP TRIGGER IF EXISTS "+trigger).Error)
	}
	for _, table := range []string{
		"billing_jobs",
		"billing_ledgers",
		"billing_requests",
		"subscription_pre_consume_records",
		"tokens",
		"user_subscriptions",
		"subscription_plans",
		"users",
	} {
		require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
	}
	previousRedisEnabled := common.RedisEnabled
	previousRDB := common.RDB
	common.RedisEnabled = false
	common.RDB = nil
	t.Cleanup(func() {
		common.RedisEnabled = previousRedisEnabled
		common.RDB = previousRDB
		for _, trigger := range []string{
			"fail_token_update",
			"fail_billing_ledger_insert",
			"fail_billing_request_update",
		} {
			DB.Exec("DROP TRIGGER IF EXISTS " + trigger)
		}
		for _, table := range []string{
			"billing_jobs",
			"billing_ledgers",
			"billing_requests",
			"subscription_pre_consume_records",
			"tokens",
			"user_subscriptions",
			"subscription_plans",
			"users",
		} {
			DB.Exec("DELETE FROM " + table)
		}
	})
}

func seedBillingWallet(t *testing.T, userQuota int, tokenQuota int, unlimited bool) (*User, *Token) {
	t.Helper()
	user := &User{
		Id:       91001,
		Username: "billing_atomic_user",
		Password: "not-used-in-test",
		Quota:    userQuota,
		Status:   common.UserStatusEnabled,
	}
	token := &Token{
		Id:             92001,
		UserId:         user.Id,
		Key:            "billing-atomic-token",
		Name:           "billing atomic token",
		Status:         common.TokenStatusEnabled,
		RemainQuota:    tokenQuota,
		UnlimitedQuota: unlimited,
	}
	require.NoError(t, DB.Create(user).Error)
	require.NoError(t, DB.Create(token).Error)
	return user, token
}

func reserveWalletParams(requestID string, user *User, token *Token, target int64) BillingReserveParams {
	return BillingReserveParams{
		RequestID:      requestID,
		FundingSource:  BillingFundingSourceWallet,
		UserID:         user.Id,
		TokenID:        token.Id,
		TokenKey:       token.Key,
		TokenUnlimited: token.UnlimitedQuota,
		TargetQuota:    target,
	}
}

func loadBillingState(t *testing.T, userID int, tokenID int, requestID string) (User, Token, BillingRequest) {
	t.Helper()
	var user User
	var token Token
	var request BillingRequest
	require.NoError(t, DB.First(&user, userID).Error)
	require.NoError(t, DB.First(&token, tokenID).Error)
	require.NoError(t, DB.Where("request_id = ?", requestID).First(&request).Error)
	return user, token, request
}

func countBillingLedgers(t *testing.T, requestID string) int64 {
	t.Helper()
	var count int64
	require.NoError(t, DB.Model(&BillingLedger{}).Where("request_id = ?", requestID).Count(&count).Error)
	return count
}

func TestReserveBillingRequestHundredConcurrentCallsUseDatabaseAuthority(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 1000, 1000, false)
	params := reserveWalletParams("reserve-100-concurrent", user, token, 300)

	start := make(chan struct{})
	errs := make(chan error, 100)
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := ReserveBillingRequest(params)
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, params.RequestID)
	assert.Equal(t, 700, gotUser.Quota)
	assert.Equal(t, 700, gotToken.RemainQuota)
	assert.Equal(t, 300, gotToken.UsedQuota)
	assert.EqualValues(t, 300, request.ReservedQuota)
	assert.EqualValues(t, 1, countBillingLedgers(t, params.RequestID))
}

func TestReserveBillingRequestConcurrentTargetsNeverExceedMaximum(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 1000, 1000, false)
	targets := []int64{100, 300, 200, 250, 300, 150, 275, 50}

	start := make(chan struct{})
	errs := make(chan error, len(targets))
	var wg sync.WaitGroup
	for _, target := range targets {
		wg.Add(1)
		go func(target int64) {
			defer wg.Done()
			<-start
			_, err := ReserveBillingRequest(reserveWalletParams("reserve-max-target", user, token, target))
			errs <- err
		}(target)
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, "reserve-max-target")
	assert.Equal(t, 700, gotUser.Quota)
	assert.Equal(t, 700, gotToken.RemainQuota)
	assert.Equal(t, 300, gotToken.UsedQuota)
	assert.EqualValues(t, 300, request.ReservedQuota)
}

func TestReserveBillingRequestExactAndInsufficientBalances(t *testing.T) {
	t.Run("exact", func(t *testing.T) {
		resetBillingFixtures(t)
		user, token := seedBillingWallet(t, 100, 100, false)
		_, err := ReserveBillingRequest(reserveWalletParams("reserve-exact", user, token, 100))
		require.NoError(t, err)
		gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, "reserve-exact")
		assert.Zero(t, gotUser.Quota)
		assert.Zero(t, gotToken.RemainQuota)
		assert.Equal(t, 100, gotToken.UsedQuota)
		assert.EqualValues(t, 100, request.ReservedQuota)
	})

	t.Run("wallet insufficient rolls back everything", func(t *testing.T) {
		resetBillingFixtures(t)
		user, token := seedBillingWallet(t, 99, 100, false)
		_, err := ReserveBillingRequest(reserveWalletParams("reserve-wallet-insufficient", user, token, 100))
		require.ErrorIs(t, err, ErrInsufficientUserQuota)
		var gotUser User
		var gotToken Token
		require.NoError(t, DB.First(&gotUser, user.Id).Error)
		require.NoError(t, DB.First(&gotToken, token.Id).Error)
		assert.Equal(t, 99, gotUser.Quota)
		assert.Equal(t, 100, gotToken.RemainQuota)
		assert.Zero(t, gotToken.UsedQuota)
		assert.Zero(t, countBillingLedgers(t, "reserve-wallet-insufficient"))
		var requests int64
		require.NoError(t, DB.Model(&BillingRequest{}).Where("request_id = ?", "reserve-wallet-insufficient").Count(&requests).Error)
		assert.Zero(t, requests)
	})

	t.Run("token insufficient rolls back wallet and request", func(t *testing.T) {
		resetBillingFixtures(t)
		user, token := seedBillingWallet(t, 100, 99, false)
		_, err := ReserveBillingRequest(reserveWalletParams("reserve-token-insufficient", user, token, 100))
		require.ErrorIs(t, err, ErrInsufficientTokenQuota)
		var gotUser User
		var gotToken Token
		require.NoError(t, DB.First(&gotUser, user.Id).Error)
		require.NoError(t, DB.First(&gotToken, token.Id).Error)
		assert.Equal(t, 100, gotUser.Quota)
		assert.Equal(t, 99, gotToken.RemainQuota)
		assert.Zero(t, gotToken.UsedQuota)
		assert.Zero(t, countBillingLedgers(t, "reserve-token-insufficient"))
	})
}

func TestReserveBillingRequestReplayTwentyTimesChargesOnce(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)
	params := reserveWalletParams("reserve-replay-20", user, token, 125)
	for i := 0; i < 20; i++ {
		result, err := ReserveBillingRequest(params)
		require.NoError(t, err)
		if i > 0 {
			assert.True(t, result.Idempotent)
		}
	}
	gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, params.RequestID)
	assert.Equal(t, 375, gotUser.Quota)
	assert.Equal(t, 375, gotToken.RemainQuota)
	assert.Equal(t, 125, gotToken.UsedQuota)
	assert.EqualValues(t, 125, request.ReservedQuota)
	assert.EqualValues(t, 1, countBillingLedgers(t, params.RequestID))
}

func TestSettleBillingRequestReplayTwentyTimes(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)
	params := reserveWalletParams("settle-replay-20", user, token, 100)
	_, err := ReserveBillingRequest(params)
	require.NoError(t, err)

	start := make(chan struct{})
	errs := make(chan error, 20)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, settleErr := SettleBillingRequest(params.RequestID, 60)
			errs <- settleErr
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for settleErr := range errs {
		require.NoError(t, settleErr)
	}

	gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, params.RequestID)
	assert.Equal(t, 440, gotUser.Quota)
	assert.Equal(t, 440, gotToken.RemainQuota)
	assert.Equal(t, 60, gotToken.UsedQuota)
	assert.Equal(t, BillingRequestStatusSettled, request.Status)
	assert.EqualValues(t, 60, request.ActualQuota)
	assert.EqualValues(t, 2, countBillingLedgers(t, params.RequestID))
}

func TestRefundBillingRequestReplayTwentyTimes(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)
	params := reserveWalletParams("refund-replay-20", user, token, 100)
	_, err := ReserveBillingRequest(params)
	require.NoError(t, err)

	start := make(chan struct{})
	errs := make(chan error, 20)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, refundErr := RefundBillingRequest(params.RequestID)
			errs <- refundErr
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for refundErr := range errs {
		require.NoError(t, refundErr)
	}

	gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, params.RequestID)
	assert.Equal(t, 500, gotUser.Quota)
	assert.Equal(t, 500, gotToken.RemainQuota)
	assert.Zero(t, gotToken.UsedQuota)
	assert.Equal(t, BillingRequestStatusRefunded, request.Status)
	assert.EqualValues(t, 100, request.RefundedQuota)
	assert.EqualValues(t, 2, countBillingLedgers(t, params.RequestID))
}

func TestSettleBillingRequestHandlesGreaterEqualAndLowerActualQuota(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		actualQuota int64
	}{
		{name: "greater", actualQuota: 140},
		{name: "equal", actualQuota: 100},
		{name: "lower", actualQuota: 60},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			resetBillingFixtures(t)
			user, token := seedBillingWallet(t, 500, 500, false)
			requestID := "settle-" + testCase.name
			_, err := ReserveBillingRequest(reserveWalletParams(requestID, user, token, 100))
			require.NoError(t, err)
			before := common.GetTimestamp()
			_, err = SettleBillingRequest(requestID, testCase.actualQuota)
			require.NoError(t, err)
			gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, requestID)
			assert.Equal(t, 500-int(testCase.actualQuota), gotUser.Quota)
			assert.Equal(t, 500-int(testCase.actualQuota), gotToken.RemainQuota)
			assert.Equal(t, int(testCase.actualQuota), gotToken.UsedQuota)
			assert.Equal(t, BillingRequestStatusSettled, request.Status)
			assert.Greater(t, request.UpdatedAt, before)
		})
	}
}

func TestBillingTransactionRollbackAtEveryWriteBoundary(t *testing.T) {
	tests := []struct {
		name       string
		triggerSQL string
	}{
		{
			name: "token update fails after wallet update",
			triggerSQL: `CREATE TRIGGER fail_token_update
				BEFORE UPDATE ON tokens
				BEGIN SELECT RAISE(FAIL, 'forced token update failure'); END`,
		},
		{
			name: "ledger insert fails after token update",
			triggerSQL: `CREATE TRIGGER fail_billing_ledger_insert
				BEFORE INSERT ON billing_ledgers
				BEGIN SELECT RAISE(FAIL, 'forced ledger failure'); END`,
		},
		{
			name: "request update fails after ledger insert",
			triggerSQL: `CREATE TRIGGER fail_billing_request_update
				BEFORE UPDATE ON billing_requests
				BEGIN SELECT RAISE(FAIL, 'forced request update failure'); END`,
		},
	}
	for index, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			resetBillingFixtures(t)
			user, token := seedBillingWallet(t, 500, 500, false)
			require.NoError(t, DB.Exec(testCase.triggerSQL).Error)
			requestID := fmt.Sprintf("rollback-boundary-%d", index)
			_, err := ReserveBillingRequest(reserveWalletParams(requestID, user, token, 100))
			require.Error(t, err)

			var gotUser User
			var gotToken Token
			require.NoError(t, DB.First(&gotUser, user.Id).Error)
			require.NoError(t, DB.First(&gotToken, token.Id).Error)
			assert.Equal(t, 500, gotUser.Quota)
			assert.Equal(t, 500, gotToken.RemainQuota)
			assert.Zero(t, gotToken.UsedQuota)
			assert.Zero(t, countBillingLedgers(t, requestID))
			var requestCount int64
			require.NoError(t, DB.Model(&BillingRequest{}).Where("request_id = ?", requestID).Count(&requestCount).Error)
			assert.Zero(t, requestCount)
		})
	}
}

func TestBillingLedgerRejectsProductionMutation(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)
	_, err := ReserveBillingRequest(reserveWalletParams("immutable-ledger", user, token, 100))
	require.NoError(t, err)

	var ledger BillingLedger
	require.NoError(t, DB.Where("request_id = ?", "immutable-ledger").First(&ledger).Error)
	err = DB.Model(&ledger).Update("amount", 1).Error
	require.ErrorIs(t, err, ErrBillingLedgerImmutable)
	err = DB.Delete(&ledger).Error
	require.ErrorIs(t, err, ErrBillingLedgerImmutable)
}

func TestBillingJobClaimUsesLeaseCAS(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)
	requestID := "job-claim-cas"
	_, err := ReserveBillingRequest(reserveWalletParams(requestID, user, token, 100))
	require.NoError(t, err)
	_, err = QueueBillingJob(requestID, BillingJobOperationRefund, 0, "forced retry")
	require.NoError(t, err)

	start := make(chan struct{})
	jobs := make(chan *BillingJob, 2)
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	claimTime := time.Now().Add(time.Minute)
	for _, workerID := range []string{"worker-a", "worker-b"} {
		wg.Add(1)
		go func(workerID string) {
			defer wg.Done()
			<-start
			job, claimErr := ClaimBillingJob(workerID, claimTime, time.Minute)
			jobs <- job
			errs <- claimErr
		}(workerID)
	}
	close(start)
	wg.Wait()
	close(jobs)
	close(errs)
	for claimErr := range errs {
		require.NoError(t, claimErr)
	}
	claimed := 0
	for job := range jobs {
		if job != nil {
			claimed++
		}
	}
	assert.Equal(t, 1, claimed)
}

func TestRedisUnavailableAndErrorsNeverPanicBilling(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)

	common.RedisEnabled = false
	require.NotPanics(t, func() {
		_, err := ReserveBillingRequest(reserveWalletParams("redis-disabled", user, token, 25))
		require.NoError(t, err)
	})

	common.RedisEnabled = true
	common.RDB = nil
	require.NotPanics(t, func() {
		_, err := ReserveBillingRequest(reserveWalletParams("redis-nil", user, token, 50))
		require.NoError(t, err)
	})
	require.ErrorIs(t, common.RedisDelKey("test"), common.ErrRedisUnavailable)

	errorClient := redis.NewClient(&redis.Options{
		Addr:         "127.0.0.1:1",
		DialTimeout:  10 * time.Millisecond,
		ReadTimeout:  10 * time.Millisecond,
		WriteTimeout: 10 * time.Millisecond,
	})
	common.RDB = errorClient
	t.Cleanup(func() {
		_ = errorClient.Close()
	})
	require.NotPanics(t, func() {
		assert.Error(t, common.RedisDelKey("test"))
	})

	timeoutClient := redis.NewClient(&redis.Options{
		Addr:        "billing-timeout.invalid:6379",
		DialTimeout: 20 * time.Millisecond,
		Dialer: func(ctx context.Context, _, _ string) (net.Conn, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	})
	common.RDB = timeoutClient
	t.Cleanup(func() {
		_ = timeoutClient.Close()
	})
	require.NotPanics(t, func() {
		assert.Error(t, common.RedisDelKey("test"))
	})

	gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, "redis-nil")
	assert.Equal(t, 425, gotUser.Quota)
	assert.Equal(t, 425, gotToken.RemainQuota)
	assert.EqualValues(t, 50, request.ReservedQuota)
}

func TestBillingRequestStateConflictsAreExplicit(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)
	requestID := "state-conflict"
	_, err := ReserveBillingRequest(reserveWalletParams(requestID, user, token, 100))
	require.NoError(t, err)
	_, err = SettleBillingRequest(requestID, 80)
	require.NoError(t, err)
	_, err = RefundBillingRequest(requestID)
	require.True(t, errors.Is(err, ErrBillingStateConflict))
	_, err = SettleBillingRequest(requestID, 90)
	require.ErrorIs(t, err, ErrBillingOperationConflict)
	err = DB.Model(&BillingRequest{}).
		Where("request_id = ?", requestID).
		Update("status", BillingRequestStatusRefunded).Error
	require.ErrorIs(t, err, ErrBillingInvalidTransition)
}

func TestSubscriptionBillingUsesSameRequestLedgerAndTokenTransaction(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)
	plan := &SubscriptionPlan{
		Id:            93001,
		Title:         "billing transaction plan",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   500,
	}
	require.NoError(t, DB.Create(plan).Error)
	subscription := &UserSubscription{
		Id:          94001,
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 500,
		AmountUsed:  0,
		StartTime:   time.Now().Add(-time.Hour).Unix(),
		EndTime:     time.Now().Add(time.Hour).Unix(),
		Status:      "active",
	}
	require.NoError(t, DB.Create(subscription).Error)

	requestID := "subscription-atomic"
	result, err := ReserveBillingRequest(BillingReserveParams{
		RequestID:      requestID,
		FundingSource:  BillingFundingSourceSubscription,
		UserID:         user.Id,
		TokenID:        token.Id,
		TokenKey:       token.Key,
		TokenUnlimited: false,
		SubscriptionID: subscription.Id,
		TargetQuota:    100,
	})
	require.NoError(t, err)
	assert.Equal(t, subscription.Id, result.Request.SubscriptionId)

	var afterReserve UserSubscription
	require.NoError(t, DB.First(&afterReserve, subscription.Id).Error)
	assert.EqualValues(t, 100, afterReserve.AmountUsed)
	gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, requestID)
	assert.Equal(t, 500, gotUser.Quota)
	assert.Equal(t, 400, gotToken.RemainQuota)
	assert.Equal(t, 100, gotToken.UsedQuota)
	assert.Equal(t, BillingFundingSourceSubscription, request.FundingSource)

	_, err = SettleBillingRequest(requestID, 60)
	require.NoError(t, err)
	require.NoError(t, DB.First(&afterReserve, subscription.Id).Error)
	assert.EqualValues(t, 60, afterReserve.AmountUsed)
	_, gotToken, request = loadBillingState(t, user.Id, token.Id, requestID)
	assert.Equal(t, 440, gotToken.RemainQuota)
	assert.Equal(t, 60, gotToken.UsedQuota)
	assert.Equal(t, BillingRequestStatusSettled, request.Status)
}

func TestBillingJobErrorsAreRedacted(t *testing.T) {
	message := "Authorization: Bearer-secret api_key=sk-1234567890 password=hunter2 postgres://user:pass@db"
	redacted := SanitizeBillingError(message)
	assert.NotContains(t, redacted, "Bearer-secret")
	assert.NotContains(t, redacted, "sk-1234567890")
	assert.NotContains(t, redacted, "hunter2")
	assert.NotContains(t, redacted, "user:pass")
}

func TestTerminalBillingCanFinishAfterUserOrTokenRevocation(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)
	requestID := "terminal-after-revocation"
	_, err := ReserveBillingRequest(reserveWalletParams(requestID, user, token, 100))
	require.NoError(t, err)
	require.NoError(t, DB.Delete(token).Error)
	require.NoError(t, DB.Delete(user).Error)

	_, err = RefundBillingRequest(requestID)
	require.NoError(t, err)
	var gotUser User
	var gotToken Token
	require.NoError(t, DB.Unscoped().First(&gotUser, user.Id).Error)
	require.NoError(t, DB.Unscoped().First(&gotToken, token.Id).Error)
	assert.Equal(t, 500, gotUser.Quota)
	assert.Equal(t, 500, gotToken.RemainQuota)
	assert.Zero(t, gotToken.UsedQuota)
}

func TestBillingAdjustmentIsAtomicAndIdempotent(t *testing.T) {
	resetBillingFixtures(t)
	user, token := seedBillingWallet(t, 500, 500, false)
	params := BillingAdjustmentParams{
		OperationKey:  "adjustment-idempotent:adjustment:100",
		RequestID:     "adjustment-idempotent",
		FundingSource: BillingFundingSourceWallet,
		UserID:        user.Id,
		TokenID:       token.Id,
		TokenKey:      token.Key,
		Delta:         100,
	}
	for i := 0; i < 20; i++ {
		_, err := ApplyBillingAdjustment(params)
		require.NoError(t, err)
	}
	gotUser, gotToken, request := loadBillingState(t, user.Id, token.Id, params.RequestID)
	assert.Equal(t, 400, gotUser.Quota)
	assert.Equal(t, 400, gotToken.RemainQuota)
	assert.Equal(t, 100, gotToken.UsedQuota)
	assert.EqualValues(t, 100, request.ActualQuota)
	assert.Equal(t, BillingRequestStatusSettled, request.Status)
	assert.EqualValues(t, 1, countBillingLedgers(t, params.RequestID))

	conflict := params
	conflict.Delta = 120
	_, err := ApplyBillingAdjustment(conflict)
	require.ErrorIs(t, err, ErrBillingOperationConflict)
}
