package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedQueuedWalletRefund(t *testing.T, requestID string, amount int64) {
	t.Helper()
	const userID, tokenID = 70, 70
	seedUser(t, userID, 500)
	seedToken(t, tokenID, userID, "job-token-"+requestID, 500)
	_, err := model.ReserveBillingRequest(model.BillingReserveParams{
		RequestID:     requestID,
		FundingSource: model.BillingFundingSourceWallet,
		UserID:        userID,
		TokenID:       tokenID,
		TokenKey:      "job-token-" + requestID,
		TargetQuota:   amount,
	})
	require.NoError(t, err)
	_, err = model.QueueBillingJob(requestID, model.BillingJobOperationRefund, 0, "test retry")
	require.NoError(t, err)
}

func TestBillingJobWorkerRecoversPendingRefundAfterRestart(t *testing.T) {
	truncate(t)
	seedQueuedWalletRefund(t, "worker-restart-refund", 100)

	config := BillingJobWorkerConfig{
		WorkerID:     "restart-worker",
		PollInterval: time.Second,
		Lease:        time.Minute,
	}
	processed, err := ProcessOneBillingJob(context.Background(), config, time.Now().Add(time.Minute))
	require.NoError(t, err)
	assert.True(t, processed)
	assert.Equal(t, 500, getUserQuota(t, 70))
	assert.Equal(t, 500, getTokenRemainQuota(t, 70))
	assert.Zero(t, getTokenUsedQuota(t, 70))

	var request model.BillingRequest
	require.NoError(t, model.DB.Where("request_id = ?", "worker-restart-refund").First(&request).Error)
	assert.Equal(t, model.BillingRequestStatusRefunded, request.Status)

	var job model.BillingJob
	require.NoError(t, model.DB.Where("request_id = ?", "worker-restart-refund").First(&job).Error)
	assert.Equal(t, model.BillingJobStatusCompleted, job.Status)
}

func TestBillingJobWorkersOnlyOneClaimsSameJob(t *testing.T) {
	truncate(t)
	seedQueuedWalletRefund(t, "worker-double-claim", 100)

	start := make(chan struct{})
	results := make(chan bool, 2)
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	now := time.Now().Add(time.Minute)
	for _, workerID := range []string{"worker-one", "worker-two"} {
		wg.Add(1)
		go func(workerID string) {
			defer wg.Done()
			<-start
			processed, err := ProcessOneBillingJob(context.Background(), BillingJobWorkerConfig{
				WorkerID: workerID,
				Lease:    time.Minute,
			}, now)
			results <- processed
			errs <- err
		}(workerID)
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	processedCount := 0
	for processed := range results {
		if processed {
			processedCount++
		}
	}
	assert.Equal(t, 1, processedCount)
	assert.Equal(t, 500, getUserQuota(t, 70))
	assert.Zero(t, getTokenUsedQuota(t, 70))
}

func TestBillingJobRetryAfterFundsCommittedDoesNotRepeatRefund(t *testing.T) {
	truncate(t)
	seedQueuedWalletRefund(t, "worker-crash-window", 100)
	firstClaimAt := time.Now().Add(time.Minute)

	job, err := model.ClaimBillingJob("crashed-worker", firstClaimAt, time.Minute)
	require.NoError(t, err)
	require.NotNil(t, job)
	_, err = model.RefundBillingRequest(job.RequestId)
	require.NoError(t, err)
	// Simulate process termination before CompleteBillingJob.

	retryAt := firstClaimAt.Add(2 * time.Minute)
	reclaimed, err := model.ClaimBillingJob("replacement-worker", retryAt, time.Minute)
	require.NoError(t, err)
	require.NotNil(t, reclaimed)
	_, err = model.RefundBillingRequest(reclaimed.RequestId)
	require.NoError(t, err)
	require.NoError(t, model.CompleteBillingJob(reclaimed.Id, "replacement-worker", retryAt))

	assert.Equal(t, 500, getUserQuota(t, 70))
	assert.Equal(t, 500, getTokenRemainQuota(t, 70))
	assert.Zero(t, getTokenUsedQuota(t, 70))
	var refundLedgers int64
	require.NoError(t, model.DB.Model(&model.BillingLedger{}).
		Where("request_id = ? AND operation = ?", "worker-crash-window", model.BillingOperationRefund).
		Count(&refundLedgers).Error)
	assert.EqualValues(t, 1, refundLedgers)
}

func TestBillingJobWorkerSupportsGracefulStop(t *testing.T) {
	truncate(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := StartBillingJobWorker(ctx, BillingJobWorkerConfig{
		WorkerID:     "graceful-worker",
		PollInterval: time.Hour,
		Lease:        time.Minute,
	})
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("billing job worker did not stop after context cancellation")
	}
}

func TestBillingJobFailurePersistsRetryWithoutPartialRefund(t *testing.T) {
	truncate(t)
	seedQueuedWalletRefund(t, "worker-persist-failure", 100)
	require.NoError(t, model.DB.Exec(`
		CREATE TRIGGER fail_token_update
		BEFORE UPDATE ON tokens
		BEGIN SELECT RAISE(FAIL, 'forced token refund failure'); END
	`).Error)
	t.Cleanup(func() {
		model.DB.Exec("DROP TRIGGER IF EXISTS fail_token_update")
	})

	processed, err := ProcessOneBillingJob(context.Background(), BillingJobWorkerConfig{
		WorkerID: "failure-worker",
		Lease:    time.Minute,
	}, time.Now().Add(time.Minute))
	require.Error(t, err)
	assert.True(t, processed)
	assert.Equal(t, 400, getUserQuota(t, 70))
	assert.Equal(t, 400, getTokenRemainQuota(t, 70))
	assert.Equal(t, 100, getTokenUsedQuota(t, 70))

	var request model.BillingRequest
	require.NoError(t, model.DB.Where("request_id = ?", "worker-persist-failure").First(&request).Error)
	assert.Equal(t, model.BillingRequestStatusRefundFailed, request.Status)
	var job model.BillingJob
	require.NoError(t, model.DB.Where("request_id = ?", "worker-persist-failure").First(&job).Error)
	assert.Equal(t, model.BillingJobStatusRetry, job.Status)
	assert.NotEmpty(t, job.LastError)
}

func TestBillingJobExhaustionMovesRequestToManualReview(t *testing.T) {
	truncate(t)
	seedQueuedWalletRefund(t, "worker-manual-review", 100)
	require.NoError(t, model.DB.Model(&model.BillingJob{}).
		Where("request_id = ?", "worker-manual-review").
		Update("max_attempts", 1).Error)
	require.NoError(t, model.DB.Exec(`
		CREATE TRIGGER fail_token_update
		BEFORE UPDATE ON tokens
		BEGIN SELECT RAISE(FAIL, 'forced token refund failure'); END
	`).Error)
	t.Cleanup(func() {
		model.DB.Exec("DROP TRIGGER IF EXISTS fail_token_update")
	})

	processed, err := ProcessOneBillingJob(context.Background(), BillingJobWorkerConfig{
		WorkerID: "manual-review-worker",
		Lease:    time.Minute,
	}, time.Now().Add(time.Minute))
	require.Error(t, err)
	assert.True(t, processed)

	var request model.BillingRequest
	require.NoError(t, model.DB.Where("request_id = ?", "worker-manual-review").First(&request).Error)
	assert.Equal(t, model.BillingRequestStatusManualReview, request.Status)
	var job model.BillingJob
	require.NoError(t, model.DB.Where("request_id = ?", "worker-manual-review").First(&job).Error)
	assert.Equal(t, model.BillingJobStatusManualReview, job.Status)
}
