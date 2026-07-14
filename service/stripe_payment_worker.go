package service

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

type StripePaymentWorkerConfig struct {
	WorkerID     string
	PollInterval time.Duration
	Lease        time.Duration
}

func DefaultStripePaymentWorkerConfig() StripePaymentWorkerConfig {
	hostname, _ := os.Hostname()
	return StripePaymentWorkerConfig{
		WorkerID:     fmt.Sprintf("stripe-%s-%d-%d", hostname, os.Getpid(), time.Now().UnixNano()),
		PollInterval: 2 * time.Second,
		Lease:        30 * time.Second,
	}
}

func StartStripePaymentWorker(ctx context.Context, config StripePaymentWorkerConfig) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		runStripePaymentWorker(ctx, config)
	}()
	return done
}

func runStripePaymentWorker(ctx context.Context, config StripePaymentWorkerConfig) {
	if config.WorkerID == "" {
		config = DefaultStripePaymentWorkerConfig()
	}
	if config.PollInterval <= 0 {
		config.PollInterval = 2 * time.Second
	}
	if config.Lease <= 0 {
		config.Lease = 30 * time.Second
	}
	logger.LogInfo(ctx, fmt.Sprintf("stripe_payment_worker started worker_id=%s", config.WorkerID))
	defer logger.LogInfo(context.Background(), fmt.Sprintf("stripe_payment_worker stopped worker_id=%s", config.WorkerID))

	for {
		processed, err := ProcessOneStripePaymentEvent(ctx, config, time.Now())
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("stripe_payment_worker process_failed worker_id=%s error=%q", config.WorkerID, model.SanitizeBillingError(err.Error())))
		}
		if processed {
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

func ProcessOneStripePaymentEvent(ctx context.Context, config StripePaymentWorkerConfig, now time.Time) (bool, error) {
	if ctx != nil {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		default:
		}
	}
	event, err := model.ClaimStripeWebhookEvent(config.WorkerID, now, config.Lease)
	if err != nil {
		return false, err
	}
	if event != nil {
		return processClaimedStripeEvent(event, config, now)
	}
	order, err := model.ClaimStripePaymentOrder(config.WorkerID, now, config.Lease)
	if err != nil || order == nil {
		return false, err
	}
	var processErr error
	switch order.Status {
	case model.StripeOrderStatusCreated, model.StripeOrderStatusCheckoutBindingFailed:
		_, processErr = CreateAndBindStripeCheckout(order)
	case model.StripeOrderStatusPaidPendingCredit, model.StripeOrderStatusCreditFailed:
		if order.LastStripeEventId == "" {
			processErr = fmt.Errorf("stripe order %s has no recovery event", order.OrderNo)
		} else {
			_, processErr = model.ProcessStripeSuccessfulEvent(order.LastStripeEventId)
		}
	default:
		processErr = fmt.Errorf("unsupported stripe order recovery status: %s", order.Status)
	}
	if processErr != nil {
		if failErr := model.FailClaimedStripeOrder(order, config.WorkerID, processErr, now); failErr != nil {
			return true, fmt.Errorf("stripe order recovery failed: %v; persisting retry failed: %w", processErr, failErr)
		}
		return true, processErr
	}
	return true, nil
}

func processClaimedStripeEvent(event *model.StripeWebhookEvent, config StripePaymentWorkerConfig, now time.Time) (bool, error) {
	var processErr error
	switch {
	case event.EventType == "checkout.session.completed",
		event.EventType == "checkout.session.async_payment_succeeded",
		event.EventType == "payment_intent.succeeded",
		strings.HasPrefix(event.EventType, "admin."):
		_, processErr = model.ProcessStripeSuccessfulEvent(event.StripeEventId)
	case event.EventType == "charge.refunded":
		processErr = model.ProcessStripeFailureEvent(event.StripeEventId, true)
	case event.EventType == "checkout.session.async_payment_failed",
		event.EventType == "checkout.session.expired",
		event.EventType == "payment_intent.payment_failed",
		event.EventType == "payment_intent.canceled":
		processErr = model.ProcessStripeFailureEvent(event.StripeEventId, false)
	default:
		processErr = model.MarkStripeEventIgnored(event.StripeEventId)
	}
	if processErr != nil {
		if failErr := model.FailClaimedStripeEvent(event, config.WorkerID, processErr, now); failErr != nil {
			return true, fmt.Errorf("stripe payment failed: %v; persisting retry failed: %w", processErr, failErr)
		}
		return true, processErr
	}
	return true, nil
}
