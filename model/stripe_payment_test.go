package model

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func resetStripePaymentFixtures(t *testing.T) {
	t.Helper()
	for _, table := range []string{
		"payment_audits",
		"payment_credit_ledgers",
		"stripe_webhook_events",
		"stripe_payment_orders",
		"top_ups",
		"subscription_orders",
		"user_subscriptions",
		"users",
	} {
		require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
	}
	stripePaymentAfterLedgerHook = nil
	stripePaymentAfterWalletHook = nil
	stripePaymentAfterOrderHook = nil
	stripePaymentBeforeAuditHook = nil
	t.Cleanup(func() {
		stripePaymentAfterLedgerHook = nil
		stripePaymentAfterWalletHook = nil
		stripePaymentAfterOrderHook = nil
		stripePaymentBeforeAuditHook = nil
	})
}

func seedStripeTopUpPayment(t *testing.T, suffix string) (*User, *StripePaymentOrder, *StripeWebhookEvent) {
	t.Helper()
	user := &User{
		Id:       96000 + len(suffix),
		Username: "stripe_" + suffix,
		Password: "not-used",
		Quota:    1000,
		Status:   common.UserStatusEnabled,
	}
	require.NoError(t, DB.Create(user).Error)
	order := &StripePaymentOrder{
		OrderNo:                 "sp_" + suffix,
		OrderKind:               StripeOrderKindTopUp,
		UserId:                  user.Id,
		Status:                  StripeOrderStatusCheckoutCreated,
		ExpectedAmountMinor:     800,
		Currency:                "usd",
		CreditedQuota:           100,
		StripeCheckoutSessionId: "cs_" + suffix,
		StripePaymentIntentId:   "pi_" + suffix,
		Livemode:                false,
		PriceConfigVersion:      "v1",
		PriceSnapshot:           `{"amount_minor":800}`,
		IdempotencyKey:          "stripe:checkout:sp_" + suffix,
		CheckoutSuccessUrl:      "https://example.com/success",
		CheckoutCancelUrl:       "https://example.com/cancel",
	}
	topUp := &TopUp{Amount: 1, Money: 1}
	require.NoError(t, CreateStripeTopUpOrder(order, topUp))
	event := &StripeWebhookEvent{
		StripeEventId:     "evt_" + suffix,
		EventType:         "checkout.session.completed",
		ApiVersion:        "2025-02-24.acacia",
		OrderNo:           order.OrderNo,
		StripeObjectId:    order.StripeCheckoutSessionId,
		CheckoutSessionId: order.StripeCheckoutSessionId,
		PaymentIntentId:   order.StripePaymentIntentId,
		AmountMinor:       order.ExpectedAmountMinor,
		Currency:          order.Currency,
		PaymentStatus:     "paid",
		PayloadDigest:     fmt.Sprintf("%064s", suffix),
	}
	require.NoError(t, DB.Create(event).Error)
	return user, order, event
}

func stripeUserQuota(t *testing.T, userID int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.First(&user, userID).Error)
	return user.Quota
}

func TestStripePaymentConcurrentEventReplayCreditsOnce(t *testing.T) {
	resetStripePaymentFixtures(t)
	user, order, event := seedStripeTopUpPayment(t, "concurrent_replay")

	start := make(chan struct{})
	errs := make(chan error, 20)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := ProcessStripeSuccessfulEvent(event.StripeEventId)
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	require.Equal(t, 1100, stripeUserQuota(t, user.Id))
	var ledgerCount int64
	require.NoError(t, DB.Model(&PaymentCreditLedger{}).Where("order_no = ?", order.OrderNo).Count(&ledgerCount).Error)
	require.Equal(t, int64(1), ledgerCount)
}

func TestStripePaymentDifferentSuccessEventsCreditOnce(t *testing.T) {
	resetStripePaymentFixtures(t)
	user, order, event := seedStripeTopUpPayment(t, "two_events")
	_, err := ProcessStripeSuccessfulEvent(event.StripeEventId)
	require.NoError(t, err)

	second := *event
	second.Id = 0
	second.StripeEventId = "evt_two_events_pi"
	second.EventType = "payment_intent.succeeded"
	second.StripeObjectId = order.StripePaymentIntentId
	second.CheckoutSessionId = ""
	second.PayloadDigest = fmt.Sprintf("%064s", "two_events_pi")
	second.Status = StripeEventStatusReceived
	second.ProcessedAt = 0
	require.NoError(t, DB.Create(&second).Error)
	_, err = ProcessStripeSuccessfulEvent(second.StripeEventId)
	require.NoError(t, err)

	require.Equal(t, 1100, stripeUserQuota(t, user.Id))
	var ledgerCount int64
	require.NoError(t, DB.Model(&PaymentCreditLedger{}).Count(&ledgerCount).Error)
	require.Equal(t, int64(1), ledgerCount)
}

func TestStripePaymentTransactionRollbackHooks(t *testing.T) {
	tests := []struct {
		name string
		set  func()
	}{
		{"after ledger", func() { stripePaymentAfterLedgerHook = func(*gorm.DB) error { return errors.New("after ledger") } }},
		{"after wallet", func() { stripePaymentAfterWalletHook = func(*gorm.DB) error { return errors.New("after wallet") } }},
		{"after order", func() { stripePaymentAfterOrderHook = func(*gorm.DB) error { return errors.New("after order") } }},
		{"before audit", func() { stripePaymentBeforeAuditHook = func(*gorm.DB) error { return errors.New("before audit") } }},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resetStripePaymentFixtures(t)
			user, order, event := seedStripeTopUpPayment(t, fmt.Sprintf("rollback_%d", index))
			test.set()
			_, err := ProcessStripeSuccessfulEvent(event.StripeEventId)
			require.Error(t, err)
			require.Equal(t, 1000, stripeUserQuota(t, user.Id))
			var ledgerCount int64
			require.NoError(t, DB.Model(&PaymentCreditLedger{}).Where("order_no = ?", order.OrderNo).Count(&ledgerCount).Error)
			require.Zero(t, ledgerCount)
			var stored StripePaymentOrder
			require.NoError(t, DB.Where("order_no = ?", order.OrderNo).First(&stored).Error)
			require.NotEqual(t, StripeOrderStatusCredited, stored.Status)
		})
	}
}

func TestStripePaymentConflictingLedgerRequiresManualReview(t *testing.T) {
	resetStripePaymentFixtures(t)
	user, order, event := seedStripeTopUpPayment(t, "ledger_conflict")
	require.NoError(t, DB.Create(&PaymentCreditLedger{
		OperationKey:  "stripe:credit:" + order.OrderNo,
		OrderNo:       order.OrderNo,
		StripeEventId: "evt_other",
		UserId:        user.Id,
		OrderKind:     order.OrderKind,
		AmountMinor:   order.ExpectedAmountMinor + 1,
		Currency:      order.Currency,
		CreditedQuota: order.CreditedQuota,
		WalletBefore:  1000,
		WalletAfter:   1100,
	}).Error)

	result, err := ProcessStripeSuccessfulEvent(event.StripeEventId)
	require.NoError(t, err)
	require.Equal(t, StripeEventStatusManualReview, result.Disposition)
	require.Equal(t, 1000, stripeUserQuota(t, user.Id))
	var stored StripePaymentOrder
	require.NoError(t, DB.Where("order_no = ?", order.OrderNo).First(&stored).Error)
	require.Equal(t, StripeOrderStatusManualReview, stored.Status)
}

func TestStripePaymentMatchingLedgerWithPendingOrderRequiresReconciliation(t *testing.T) {
	resetStripePaymentFixtures(t)
	user, order, event := seedStripeTopUpPayment(t, "ledger_pending")
	require.NoError(t, DB.Create(&PaymentCreditLedger{
		OperationKey:  "stripe:credit:" + order.OrderNo,
		OrderNo:       order.OrderNo,
		StripeEventId: event.StripeEventId,
		UserId:        user.Id,
		OrderKind:     order.OrderKind,
		AmountMinor:   order.ExpectedAmountMinor,
		Currency:      order.Currency,
		CreditedQuota: order.CreditedQuota,
		WalletBefore:  1000,
		WalletAfter:   1100,
	}).Error)
	result, err := ProcessStripeSuccessfulEvent(event.StripeEventId)
	require.NoError(t, err)
	require.Equal(t, StripeEventStatusManualReview, result.Disposition)
	require.Equal(t, 1000, stripeUserQuota(t, user.Id))
}

func TestStripePaymentRejectsMismatchedSuccessfulEvents(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*StripeWebhookEvent)
	}{
		{"amount low", func(event *StripeWebhookEvent) { event.AmountMinor-- }},
		{"amount high", func(event *StripeWebhookEvent) { event.AmountMinor++ }},
		{"currency", func(event *StripeWebhookEvent) { event.Currency = "eur" }},
		{"livemode", func(event *StripeWebhookEvent) { event.Livemode = true }},
		{"session", func(event *StripeWebhookEvent) { event.CheckoutSessionId = "cs_wrong" }},
		{"payment intent", func(event *StripeWebhookEvent) { event.PaymentIntentId = "pi_wrong" }},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resetStripePaymentFixtures(t)
			user, order, event := seedStripeTopUpPayment(t, fmt.Sprintf("mismatch_%d", index))
			test.mutate(event)
			require.NoError(t, DB.Save(event).Error)
			result, err := ProcessStripeSuccessfulEvent(event.StripeEventId)
			require.NoError(t, err)
			require.Equal(t, StripeEventStatusManualReview, result.Disposition)
			require.Equal(t, 1000, stripeUserQuota(t, user.Id))
			var ledgerCount int64
			require.NoError(t, DB.Model(&PaymentCreditLedger{}).Where("order_no = ?", order.OrderNo).Count(&ledgerCount).Error)
			require.Zero(t, ledgerCount)
		})
	}
}

func TestStripeFailureEventRequiresBoundObject(t *testing.T) {
	resetStripePaymentFixtures(t)
	user, order, event := seedStripeTopUpPayment(t, "failure_binding")
	event.EventType = "payment_intent.payment_failed"
	event.CheckoutSessionId = ""
	event.PaymentIntentId = "pi_unknown"
	event.StripeObjectId = event.PaymentIntentId
	event.PaymentStatus = "requires_payment_method"
	require.NoError(t, DB.Save(event).Error)
	require.NoError(t, ProcessStripeFailureEvent(event.StripeEventId, false))
	require.Equal(t, 1000, stripeUserQuota(t, user.Id))
	var stored StripePaymentOrder
	require.NoError(t, DB.Where("order_no = ?", order.OrderNo).First(&stored).Error)
	require.Equal(t, StripeOrderStatusManualReview, stored.Status)
}

func TestStripeAdminActorIsAuditedInCreditTransaction(t *testing.T) {
	resetStripePaymentFixtures(t)
	_, order, event := seedStripeTopUpPayment(t, "admin_audit")
	_, err := ProcessStripeSuccessfulEventWithActor(event.StripeEventId, StripePaymentActor{
		Type:   "admin",
		Id:     42,
		Reason: " verified in Stripe dashboard ",
	})
	require.NoError(t, err)
	var audit PaymentAudit
	require.NoError(t, DB.Where("order_no = ?", order.OrderNo).First(&audit).Error)
	require.Equal(t, "admin", audit.ActorType)
	require.Equal(t, 42, audit.ActorId)
	require.Equal(t, "verified in Stripe dashboard", audit.Reason)
}

func TestStripeFailureCannotDowngradeCreditedOrder(t *testing.T) {
	resetStripePaymentFixtures(t)
	_, order, event := seedStripeTopUpPayment(t, "failure_after_success")
	_, err := ProcessStripeSuccessfulEvent(event.StripeEventId)
	require.NoError(t, err)
	failed := *event
	failed.Id = 0
	failed.StripeEventId = "evt_failure_after_success_failed"
	failed.EventType = "payment_intent.payment_failed"
	failed.CheckoutSessionId = ""
	failed.StripeObjectId = order.StripePaymentIntentId
	failed.PaymentStatus = "requires_payment_method"
	failed.PayloadDigest = fmt.Sprintf("%064s", "failure_after_success_failed")
	failed.Status = StripeEventStatusReceived
	failed.ProcessedAt = 0
	require.NoError(t, DB.Create(&failed).Error)
	require.NoError(t, ProcessStripeFailureEvent(failed.StripeEventId, false))
	var stored StripePaymentOrder
	require.NoError(t, DB.Where("order_no = ?", order.OrderNo).First(&stored).Error)
	require.Equal(t, StripeOrderStatusCredited, stored.Status)
}

func TestStripeRefundNeverCreditsAndRequiresManualReview(t *testing.T) {
	resetStripePaymentFixtures(t)
	user, order, event := seedStripeTopUpPayment(t, "refund_review")
	event.EventType = "charge.refunded"
	event.StripeObjectId = "ch_refund_review"
	event.CheckoutSessionId = ""
	event.PaymentIntentId = ""
	event.PaymentStatus = ""
	require.NoError(t, DB.Save(event).Error)
	require.NoError(t, ProcessStripeFailureEvent(event.StripeEventId, true))
	require.Equal(t, 1000, stripeUserQuota(t, user.Id))
	var stored StripePaymentOrder
	require.NoError(t, DB.Where("order_no = ?", order.OrderNo).First(&stored).Error)
	require.Equal(t, StripeOrderStatusManualReview, stored.Status)
	var ledgerCount int64
	require.NoError(t, DB.Model(&PaymentCreditLedger{}).Count(&ledgerCount).Error)
	require.Zero(t, ledgerCount)
}

func TestLegacyStripeCreditPathsAreClosed(t *testing.T) {
	resetStripePaymentFixtures(t)
	user := &User{Id: 97901, Username: "legacy_stripe", Password: "unused", Quota: 500, Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	topUp := &TopUp{
		UserId:          user.Id,
		Amount:          1,
		Money:           1,
		TradeNo:         "legacy-stripe-order",
		PaymentMethod:   PaymentMethodStripe,
		PaymentProvider: PaymentProviderStripe,
		Status:          common.TopUpStatusPending,
	}
	require.NoError(t, DB.Create(topUp).Error)
	require.Error(t, Recharge(topUp.TradeNo, "cus_test", "127.0.0.1"))
	require.Error(t, ManualCompleteTopUp(topUp.TradeNo, "127.0.0.1"))
	require.Equal(t, 500, stripeUserQuota(t, user.Id))
}

func TestStripeOrderLeaseClaimIsSingleWinner(t *testing.T) {
	resetStripePaymentFixtures(t)
	_, order, _ := seedStripeTopUpPayment(t, "order_lease")
	require.NoError(t, DB.Model(&StripePaymentOrder{}).Where("id = ?", order.Id).Updates(map[string]interface{}{
		"status":        StripeOrderStatusCheckoutBindingFailed,
		"next_retry_at": time.Now().Add(-time.Minute).Unix(),
	}).Error)

	start := make(chan struct{})
	results := make(chan *StripePaymentOrder, 2)
	var wg sync.WaitGroup
	for _, worker := range []string{"worker-a", "worker-b"} {
		wg.Add(1)
		go func(workerID string) {
			defer wg.Done()
			<-start
			claimed, _ := ClaimStripePaymentOrder(workerID, time.Now(), time.Minute)
			results <- claimed
		}(worker)
	}
	close(start)
	wg.Wait()
	close(results)
	winners := 0
	for claimed := range results {
		if claimed != nil {
			winners++
		}
	}
	require.Equal(t, 1, winners)
}

func TestBindStripeCheckoutSessionIsIdempotentAndRejectsConflicts(t *testing.T) {
	resetStripePaymentFixtures(t)
	user := &User{Id: 98101, Username: "stripe_bind", Password: "unused", Quota: 500, Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	order := &StripePaymentOrder{
		OrderNo:             "sp_bind_conflict",
		OrderKind:           StripeOrderKindTopUp,
		UserId:              user.Id,
		ExpectedAmountMinor: 800,
		Currency:            "usd",
		CreditedQuota:       100,
		Livemode:            false,
		PriceConfigVersion:  "v1",
		PriceSnapshot:       `{}`,
		IdempotencyKey:      "stripe:checkout:sp_bind_conflict",
		CheckoutSuccessUrl:  "https://example.com/success",
		CheckoutCancelUrl:   "https://example.com/cancel",
	}
	require.NoError(t, CreateStripeTopUpOrder(order, &TopUp{Amount: 1, Money: 1}))

	require.NoError(t, BindStripeCheckoutSession(
		order.OrderNo, "cs_authoritative", "pi_authoritative", "cus_authoritative",
		"https://checkout.stripe.test/authoritative", false,
	))
	require.NoError(t, BindStripeCheckoutSession(
		order.OrderNo, "cs_authoritative", "pi_authoritative", "cus_authoritative",
		"https://checkout.stripe.test/authoritative", false,
	))

	tests := []struct {
		name            string
		sessionID       string
		paymentIntentID string
		customerID      string
		livemode        bool
	}{
		{name: "session", sessionID: "cs_conflict", paymentIntentID: "pi_authoritative", customerID: "cus_authoritative"},
		{name: "payment intent", sessionID: "cs_authoritative", paymentIntentID: "pi_conflict", customerID: "cus_authoritative"},
		{name: "customer", sessionID: "cs_authoritative", paymentIntentID: "pi_authoritative", customerID: "cus_conflict"},
		{name: "livemode", sessionID: "cs_authoritative", paymentIntentID: "pi_authoritative", customerID: "cus_authoritative", livemode: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := BindStripeCheckoutSession(
				order.OrderNo, test.sessionID, test.paymentIntentID, test.customerID,
				"https://checkout.stripe.test/conflict", test.livemode,
			)
			require.ErrorIs(t, err, ErrStripeBindingConflict)

			stored, getErr := GetStripePaymentOrder(order.OrderNo)
			require.NoError(t, getErr)
			require.Equal(t, "cs_authoritative", stored.StripeCheckoutSessionId)
			require.Equal(t, "pi_authoritative", stored.StripePaymentIntentId)
			require.Equal(t, "cus_authoritative", stored.StripeCustomerId)
			require.False(t, stored.Livemode)
			require.Equal(t, StripeOrderStatusManualReview, stored.Status)
		})
	}
}

func TestConcurrentStripeCheckoutBindingHasOneAuthoritativeResult(t *testing.T) {
	resetStripePaymentFixtures(t)
	user := &User{Id: 98102, Username: "stripe_bind_race", Password: "unused", Quota: 500, Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	order := &StripePaymentOrder{
		OrderNo:             "sp_bind_race",
		OrderKind:           StripeOrderKindTopUp,
		UserId:              user.Id,
		ExpectedAmountMinor: 800,
		Currency:            "usd",
		CreditedQuota:       100,
		PriceConfigVersion:  "v1",
		PriceSnapshot:       `{}`,
		IdempotencyKey:      "stripe:checkout:sp_bind_race",
		CheckoutSuccessUrl:  "https://example.com/success",
		CheckoutCancelUrl:   "https://example.com/cancel",
	}
	require.NoError(t, CreateStripeTopUpOrder(order, &TopUp{Amount: 1, Money: 1}))

	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, sessionID := range []string{"cs_race_a", "cs_race_b"} {
		wg.Add(1)
		go func(candidate string) {
			defer wg.Done()
			<-start
			errs <- BindStripeCheckoutSession(
				order.OrderNo, candidate, "", "", "https://checkout.stripe.test/"+candidate, false,
			)
		}(sessionID)
	}
	close(start)
	wg.Wait()
	close(errs)

	successes := 0
	conflicts := 0
	for err := range errs {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrStripeBindingConflict):
			conflicts++
		default:
			require.NoError(t, err)
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, conflicts)

	stored, err := GetStripePaymentOrder(order.OrderNo)
	require.NoError(t, err)
	require.Contains(t, []string{"cs_race_a", "cs_race_b"}, stored.StripeCheckoutSessionId)
}
