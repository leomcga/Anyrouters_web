package service

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

type BillingJobWorkerConfig struct {
	WorkerID     string
	PollInterval time.Duration
	Lease        time.Duration
}

func DefaultBillingJobWorkerConfig() BillingJobWorkerConfig {
	hostname, _ := os.Hostname()
	return BillingJobWorkerConfig{
		WorkerID:     fmt.Sprintf("%s-%d-%d", hostname, os.Getpid(), time.Now().UnixNano()),
		PollInterval: 2 * time.Second,
		Lease:        30 * time.Second,
	}
}

func StartBillingJobWorker(ctx context.Context, config BillingJobWorkerConfig) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		RunBillingJobWorker(ctx, config)
	}()
	return done
}

func RunBillingJobWorker(ctx context.Context, config BillingJobWorkerConfig) {
	if ctx == nil {
		ctx = context.Background()
	}
	if config.WorkerID == "" {
		config = DefaultBillingJobWorkerConfig()
	}
	if config.PollInterval <= 0 {
		config.PollInterval = 2 * time.Second
	}
	if config.Lease <= 0 {
		config.Lease = 30 * time.Second
	}

	logger.LogInfo(ctx, fmt.Sprintf("billing_job_worker started worker_id=%s", config.WorkerID))
	defer logger.LogInfo(context.Background(), fmt.Sprintf("billing_job_worker stopped worker_id=%s", config.WorkerID))

	for {
		processed, err := ProcessOneBillingJob(ctx, config, time.Now())
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf(
				"billing_job_worker process_failed worker_id=%s error=%s",
				config.WorkerID,
				model.SanitizeBillingError(err.Error()),
			))
		}
		if processed {
			continue
		}
		if recovered, recoverErr := RecoverStaleSandboxExecutions(ctx, time.Now().Add(-5*time.Minute).Unix(), 20); recoverErr != nil {
			logger.LogWarn(ctx, fmt.Sprintf("sandbox stale reservation recovery failed: %s", model.SanitizeBillingError(recoverErr.Error())))
		} else if recovered > 0 {
			continue
		}

		timer := time.NewTimer(config.PollInterval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
		}
	}
}

func ProcessOneBillingJob(ctx context.Context, config BillingJobWorkerConfig, now time.Time) (bool, error) {
	if ctx != nil {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		default:
		}
	}

	job, err := model.ClaimBillingJob(config.WorkerID, now, config.Lease)
	if err != nil {
		return false, err
	}
	if job == nil {
		return false, nil
	}

	var runErr error
	switch job.OperationType {
	case model.BillingJobOperationSettle:
		_, runErr = model.SettleBillingRequest(job.RequestId, job.TargetQuota)
	case model.BillingJobOperationRefund:
		_, runErr = model.RefundBillingRequest(job.RequestId)
	default:
		runErr = fmt.Errorf("unsupported billing job operation: %s", job.OperationType)
	}
	if runErr != nil {
		if failErr := model.FailBillingJob(job, config.WorkerID, runErr, now); failErr != nil {
			return true, fmt.Errorf("billing operation failed: %v; persisting failure failed: %w", runErr, failErr)
		}
		return true, runErr
	}
	if err := model.CompleteBillingJob(job.Id, config.WorkerID, now); err != nil {
		return true, err
	}
	return true, nil
}
