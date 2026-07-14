package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81"
)

func seedRecoverableStripeOrder(t *testing.T, suffix string) *model.StripePaymentOrder {
	t.Helper()
	truncate(t)
	user := &model.User{
		Id:       88001,
		Username: "stripe_recovery_" + suffix,
		Password: "unused",
		Quota:    1000,
		Status:   common.UserStatusEnabled,
	}
	require.NoError(t, model.DB.Create(user).Error)
	order := &model.StripePaymentOrder{
		OrderNo:               "sp_recovery_" + suffix,
		OrderKind:             model.StripeOrderKindTopUp,
		UserId:                user.Id,
		ExpectedAmountMinor:   800,
		Currency:              "usd",
		CreditedQuota:         100,
		PriceConfigVersion:    "v1",
		PriceSnapshot:         `{"amount_minor":800}`,
		IdempotencyKey:        "stripe:checkout:sp_recovery_" + suffix,
		CheckoutSuccessUrl:    "https://example.com/success",
		CheckoutCancelUrl:     "https://example.com/cancel",
		CheckoutCustomerEmail: "user@example.com",
	}
	require.NoError(t, model.CreateStripeTopUpOrder(order, &model.TopUp{Amount: 1, Money: 1}))
	return order
}

func TestStripeCheckoutBindingFailureReplaysSameIdempotentSession(t *testing.T) {
	order := seedRecoverableStripeOrder(t, "binding")
	originalCreate := StripeCreateCheckoutSession
	t.Cleanup(func() { StripeCreateCheckoutSession = originalCreate })

	var keys []string
	StripeCreateCheckoutSession = func(params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
		require.NotNil(t, params.GetParams().IdempotencyKey)
		keys = append(keys, *params.GetParams().IdempotencyKey)
		return &stripe.CheckoutSession{ID: "cs_recovered", URL: "https://checkout.stripe.test/recovered"}, nil
	}
	require.NoError(t, model.DB.Exec(`
		CREATE TRIGGER fail_stripe_binding
		BEFORE UPDATE ON stripe_payment_orders
		WHEN NEW.stripe_checkout_session_id <> ''
		BEGIN
			SELECT RAISE(FAIL, 'bind failed');
		END
	`).Error)
	_, err := CreateAndBindStripeCheckout(order)
	require.Error(t, err)
	require.NoError(t, model.MarkStripeCheckoutBindingFailed(order.OrderNo, err))
	require.NoError(t, model.DB.Exec("DROP TRIGGER fail_stripe_binding").Error)

	stored, err := model.GetStripePaymentOrder(order.OrderNo)
	require.NoError(t, err)
	require.Equal(t, model.StripeOrderStatusCheckoutBindingFailed, stored.Status)
	require.Empty(t, stored.StripeCheckoutSessionId)

	checkout, err := CreateAndBindStripeCheckout(stored)
	require.NoError(t, err)
	require.Equal(t, "cs_recovered", checkout.ID)
	require.Len(t, keys, 2)
	require.Equal(t, keys[0], keys[1])

	stored, err = model.GetStripePaymentOrder(order.OrderNo)
	require.NoError(t, err)
	require.Equal(t, "cs_recovered", stored.StripeCheckoutSessionId)
	require.Equal(t, model.StripeOrderStatusCheckoutCreated, stored.Status)
}

func TestStripeCheckoutAlreadyBoundDoesNotCreateAgain(t *testing.T) {
	order := seedRecoverableStripeOrder(t, "already_bound")
	require.NoError(t, model.BindStripeCheckoutSession(order.OrderNo, "cs_existing", "", "", "https://checkout.stripe.test/existing", false))
	stored, err := model.GetStripePaymentOrder(order.OrderNo)
	require.NoError(t, err)

	originalCreate := StripeCreateCheckoutSession
	t.Cleanup(func() { StripeCreateCheckoutSession = originalCreate })
	StripeCreateCheckoutSession = func(*stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
		return nil, errors.New("must not create another session")
	}
	checkout, err := CreateAndBindStripeCheckout(stored)
	require.NoError(t, err)
	require.Equal(t, "cs_existing", checkout.ID)
}

func TestStripeWorkerRecoversCheckoutBindingAfterRestart(t *testing.T) {
	order := seedRecoverableStripeOrder(t, "worker_restart")
	require.NoError(t, model.MarkStripeCheckoutBindingFailed(order.OrderNo, errors.New("database unavailable")))

	originalCreate := StripeCreateCheckoutSession
	t.Cleanup(func() { StripeCreateCheckoutSession = originalCreate })
	StripeCreateCheckoutSession = func(*stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
		return &stripe.CheckoutSession{ID: "cs_worker_recovered", URL: "https://checkout.stripe.test/worker"}, nil
	}
	processed, err := ProcessOneStripePaymentEvent(context.Background(), StripePaymentWorkerConfig{
		WorkerID: "restart-worker",
		Lease:    time.Minute,
	}, time.Now().Add(time.Minute))
	require.NoError(t, err)
	require.True(t, processed)
	stored, err := model.GetStripePaymentOrder(order.OrderNo)
	require.NoError(t, err)
	require.Equal(t, "cs_worker_recovered", stored.StripeCheckoutSessionId)
}

func TestStripeWorkersOnlyOneClaimsCheckoutRecovery(t *testing.T) {
	order := seedRecoverableStripeOrder(t, "worker_claim")
	require.NoError(t, model.MarkStripeCheckoutBindingFailed(order.OrderNo, errors.New("retry")))
	originalCreate := StripeCreateCheckoutSession
	t.Cleanup(func() { StripeCreateCheckoutSession = originalCreate })

	started := make(chan struct{}, 2)
	release := make(chan struct{})
	var once sync.Once
	StripeCreateCheckoutSession = func(*stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
		started <- struct{}{}
		once.Do(func() { <-release })
		return &stripe.CheckoutSession{ID: "cs_single_claim", URL: "https://checkout.stripe.test/single"}, nil
	}

	now := time.Now().Add(time.Minute)
	results := make(chan bool, 2)
	errs := make(chan error, 2)
	for _, workerID := range []string{"worker-1", "worker-2"} {
		go func(id string) {
			processed, err := ProcessOneStripePaymentEvent(context.Background(), StripePaymentWorkerConfig{
				WorkerID: id,
				Lease:    time.Minute,
			}, now)
			results <- processed
			errs <- err
		}(workerID)
	}
	<-started
	close(release)
	for i := 0; i < 2; i++ {
		require.NoError(t, <-errs)
	}
	processedCount := 0
	for i := 0; i < 2; i++ {
		if <-results {
			processedCount++
		}
	}
	require.Equal(t, 1, processedCount)
}
