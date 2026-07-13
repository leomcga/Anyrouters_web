package model

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	StripeOrderKindTopUp        = "topup"
	StripeOrderKindSubscription = "subscription"

	StripeOrderStatusCreated               = "created"
	StripeOrderStatusCheckoutCreated       = "checkout_created"
	StripeOrderStatusCheckoutBindingFailed = "checkout_binding_failed"
	StripeOrderStatusPaymentPending        = "payment_pending"
	StripeOrderStatusPaidPendingCredit     = "paid_pending_credit"
	StripeOrderStatusCredited              = "credited"
	StripeOrderStatusPaymentFailed         = "payment_failed"
	StripeOrderStatusCreditFailed          = "credit_failed"
	StripeOrderStatusCancelled             = "cancelled"
	StripeOrderStatusRefunded              = "refunded"
	StripeOrderStatusManualReview          = "manual_review"

	StripeEventStatusReceived     = "received"
	StripeEventStatusProcessing   = "processing"
	StripeEventStatusProcessed    = "processed"
	StripeEventStatusIgnored      = "ignored"
	StripeEventStatusRetry        = "retry"
	StripeEventStatusCreditFailed = "credit_failed"
	StripeEventStatusRejected     = "rejected"
	StripeEventStatusManualReview = "manual_review"
)

var (
	ErrStripeOrderNotFound       = errors.New("stripe payment order not found")
	ErrStripeEventConflict       = errors.New("stripe webhook event payload conflict")
	ErrStripePaymentMismatch     = errors.New("stripe payment does not match local order")
	ErrStripeEventLeaseConflict  = errors.New("stripe webhook event lease conflict")
	ErrStripePaymentAlreadyFinal = errors.New("stripe payment order is already final")
	ErrStripeBindingConflict     = errors.New("stripe payment object binding conflict")
)

type StripePaymentOrder struct {
	Id                      int64  `json:"id" gorm:"primaryKey"`
	OrderNo                 string `json:"order_no" gorm:"type:varchar(64);not null;uniqueIndex:idx_stripe_payment_orders_order_no"`
	OrderKind               string `json:"order_kind" gorm:"type:varchar(32);not null;index:idx_stripe_payment_orders_kind"`
	LegacyTopUpId           int    `json:"legacy_topup_id" gorm:"not null;default:0;index"`
	LegacySubscriptionOrder int    `json:"legacy_subscription_order_id" gorm:"not null;default:0;index"`
	UserId                  int    `json:"user_id" gorm:"not null;index:idx_stripe_payment_orders_user_id"`
	PlanId                  int    `json:"plan_id" gorm:"not null;default:0;index"`
	Provider                string `json:"provider" gorm:"type:varchar(32);not null;default:'stripe'"`
	Status                  string `json:"status" gorm:"type:varchar(32);not null;index:idx_stripe_payment_orders_scan,priority:1"`
	ExpectedAmountMinor     int64  `json:"expected_amount_minor" gorm:"type:bigint;not null"`
	Currency                string `json:"currency" gorm:"type:varchar(8);not null"`
	CreditedQuota           int64  `json:"credited_quota" gorm:"type:bigint;not null;default:0"`
	StripeCheckoutSessionId string `json:"stripe_checkout_session_id" gorm:"type:varchar(255);not null;default:''"`
	StripePaymentIntentId   string `json:"stripe_payment_intent_id" gorm:"type:varchar(255);not null;default:''"`
	StripeCustomerId        string `json:"stripe_customer_id" gorm:"type:varchar(255);not null;default:''"`
	CheckoutCustomerEmail   string `json:"-" gorm:"type:varchar(255);not null;default:''"`
	StripePriceId           string `json:"stripe_price_id" gorm:"type:varchar(255);not null;default:''"`
	CheckoutSuccessUrl      string `json:"-" gorm:"type:text;not null"`
	CheckoutCancelUrl       string `json:"-" gorm:"type:text;not null"`
	CheckoutUrl             string `json:"checkout_url" gorm:"type:text;not null"`
	LastStripeEventId       string `json:"last_stripe_event_id" gorm:"type:varchar(255);not null;default:'';index:idx_stripe_payment_orders_last_event"`
	Livemode                bool   `json:"livemode" gorm:"not null;default:false;index"`
	PriceConfigVersion      string `json:"price_config_version" gorm:"type:varchar(128);not null"`
	PriceSnapshot           string `json:"price_snapshot" gorm:"type:text;not null"`
	IdempotencyKey          string `json:"-" gorm:"type:varchar(128);not null;uniqueIndex:idx_stripe_payment_orders_idempotency"`
	PaidAt                  int64  `json:"paid_at" gorm:"type:bigint;not null;default:0"`
	CreditedAt              int64  `json:"credited_at" gorm:"type:bigint;not null;default:0"`
	FailedAt                int64  `json:"failed_at" gorm:"type:bigint;not null;default:0"`
	LastError               string `json:"last_error" gorm:"type:text;not null"`
	Attempts                int    `json:"attempts" gorm:"not null;default:0"`
	MaxAttempts             int    `json:"max_attempts" gorm:"not null;default:12"`
	NextRetryAt             int64  `json:"next_retry_at" gorm:"type:bigint;not null;default:0;index:idx_stripe_payment_orders_scan,priority:2"`
	LockedBy                string `json:"locked_by" gorm:"type:varchar(128);not null;default:''"`
	LockedUntil             int64  `json:"locked_until" gorm:"type:bigint;not null;default:0;index:idx_stripe_payment_orders_locked_until"`
	Version                 int64  `json:"version" gorm:"type:bigint;not null;default:1"`
	CreatedAt               int64  `json:"created_at" gorm:"type:bigint;not null;index"`
	UpdatedAt               int64  `json:"updated_at" gorm:"type:bigint;not null"`
}

func (o *StripePaymentOrder) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	if o.OrderNo == "" {
		value, err := newStripeOpaqueID("sp_")
		if err != nil {
			return err
		}
		o.OrderNo = value
	}
	if o.IdempotencyKey == "" {
		o.IdempotencyKey = "stripe:checkout:" + o.OrderNo
	}
	o.Currency = strings.ToLower(strings.TrimSpace(o.Currency))
	if o.Provider == "" {
		o.Provider = PaymentProviderStripe
	}
	if o.Status == "" {
		o.Status = StripeOrderStatusCreated
	}
	if o.Version == 0 {
		o.Version = 1
	}
	if o.MaxAttempts <= 0 {
		o.MaxAttempts = 12
	}
	if o.NextRetryAt == 0 {
		o.NextRetryAt = now
	}
	if o.CreatedAt == 0 {
		o.CreatedAt = now
	}
	if o.UpdatedAt == 0 {
		o.UpdatedAt = now
	}
	return nil
}

type StripeWebhookEvent struct {
	Id                int64  `json:"id" gorm:"primaryKey"`
	StripeEventId     string `json:"stripe_event_id" gorm:"type:varchar(255);not null;uniqueIndex:idx_stripe_webhook_events_event_id"`
	EventType         string `json:"event_type" gorm:"type:varchar(128);not null;index"`
	ApiVersion        string `json:"api_version" gorm:"type:varchar(64);not null"`
	Livemode          bool   `json:"livemode" gorm:"not null;index"`
	Status            string `json:"status" gorm:"type:varchar(32);not null;index:idx_stripe_webhook_events_scan,priority:1"`
	Attempts          int    `json:"attempts" gorm:"not null;default:0"`
	MaxAttempts       int    `json:"max_attempts" gorm:"not null;default:12"`
	OrderNo           string `json:"order_no" gorm:"type:varchar(64);not null;default:'';index"`
	StripeObjectId    string `json:"stripe_object_id" gorm:"type:varchar(255);not null;default:'';index"`
	CheckoutSessionId string `json:"checkout_session_id" gorm:"type:varchar(255);not null;default:''"`
	PaymentIntentId   string `json:"payment_intent_id" gorm:"type:varchar(255);not null;default:''"`
	CustomerId        string `json:"customer_id" gorm:"type:varchar(255);not null;default:''"`
	AmountMinor       int64  `json:"amount_minor" gorm:"type:bigint;not null;default:0"`
	Currency          string `json:"currency" gorm:"type:varchar(8);not null;default:''"`
	PaymentStatus     string `json:"payment_status" gorm:"type:varchar(32);not null;default:''"`
	PayloadDigest     string `json:"payload_digest" gorm:"type:varchar(64);not null"`
	LastError         string `json:"last_error" gorm:"type:text;not null"`
	NextRetryAt       int64  `json:"next_retry_at" gorm:"type:bigint;not null;default:0;index:idx_stripe_webhook_events_scan,priority:2"`
	LockedBy          string `json:"locked_by" gorm:"type:varchar(128);not null;default:''"`
	LockedUntil       int64  `json:"locked_until" gorm:"type:bigint;not null;default:0;index"`
	ReceivedAt        int64  `json:"received_at" gorm:"type:bigint;not null"`
	ProcessedAt       int64  `json:"processed_at" gorm:"type:bigint;not null;default:0"`
	Version           int64  `json:"version" gorm:"type:bigint;not null;default:1"`
	CreatedAt         int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt         int64  `json:"updated_at" gorm:"type:bigint;not null"`
}

func (e *StripeWebhookEvent) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	e.Currency = strings.ToLower(strings.TrimSpace(e.Currency))
	if e.Status == "" {
		e.Status = StripeEventStatusReceived
	}
	if e.MaxAttempts <= 0 {
		e.MaxAttempts = 12
	}
	if e.NextRetryAt == 0 {
		e.NextRetryAt = now
	}
	if e.ReceivedAt == 0 {
		e.ReceivedAt = now
	}
	if e.Version == 0 {
		e.Version = 1
	}
	if e.CreatedAt == 0 {
		e.CreatedAt = now
	}
	if e.UpdatedAt == 0 {
		e.UpdatedAt = now
	}
	return nil
}

type PaymentCreditLedger struct {
	Id            int64  `json:"id" gorm:"primaryKey"`
	OperationKey  string `json:"operation_key" gorm:"type:varchar(128);not null;uniqueIndex:idx_payment_credit_ledgers_operation_key"`
	OrderNo       string `json:"order_no" gorm:"type:varchar(64);not null;uniqueIndex:idx_payment_credit_ledgers_order_no"`
	StripeEventId string `json:"stripe_event_id" gorm:"type:varchar(255);not null;index"`
	UserId        int    `json:"user_id" gorm:"not null;index"`
	OrderKind     string `json:"order_kind" gorm:"type:varchar(32);not null"`
	AmountMinor   int64  `json:"amount_minor" gorm:"type:bigint;not null"`
	Currency      string `json:"currency" gorm:"type:varchar(8);not null"`
	CreditedQuota int64  `json:"credited_quota" gorm:"type:bigint;not null;default:0"`
	WalletBefore  int64  `json:"wallet_before" gorm:"type:bigint;not null"`
	WalletAfter   int64  `json:"wallet_after" gorm:"type:bigint;not null"`
	CreatedAt     int64  `json:"created_at" gorm:"type:bigint;not null;index"`
}

func (l *PaymentCreditLedger) BeforeCreate(_ *gorm.DB) error {
	if l.CreatedAt == 0 {
		l.CreatedAt = common.GetTimestamp()
	}
	return nil
}

func (*PaymentCreditLedger) BeforeUpdate(*gorm.DB) error {
	return ErrBillingLedgerImmutable
}

func (*PaymentCreditLedger) BeforeDelete(*gorm.DB) error {
	return ErrBillingLedgerImmutable
}

type PaymentAudit struct {
	Id             int64  `json:"id" gorm:"primaryKey"`
	OrderNo        string `json:"order_no" gorm:"type:varchar(64);not null;index"`
	StripeEventId  string `json:"stripe_event_id" gorm:"type:varchar(255);not null;default:'';index"`
	ActorType      string `json:"actor_type" gorm:"type:varchar(32);not null"`
	ActorId        int    `json:"actor_id" gorm:"not null;default:0"`
	Action         string `json:"action" gorm:"type:varchar(64);not null;index"`
	Reason         string `json:"reason" gorm:"type:varchar(255);not null;default:''"`
	StatusBefore   string `json:"status_before" gorm:"type:varchar(32);not null;default:''"`
	StatusAfter    string `json:"status_after" gorm:"type:varchar(32);not null;default:''"`
	StripeObjectId string `json:"stripe_object_id" gorm:"type:varchar(255);not null;default:''"`
	CreatedAt      int64  `json:"created_at" gorm:"type:bigint;not null;index"`
}

func (a *PaymentAudit) BeforeCreate(_ *gorm.DB) error {
	if a.CreatedAt == 0 {
		a.CreatedAt = common.GetTimestamp()
	}
	return nil
}

type StripeEventProcessingResult struct {
	Disposition string
	OrderNo     string
	UserId      int
	Credited    bool
}

type StripePaymentActor struct {
	Type   string
	Id     int
	Reason string
}

var (
	stripePaymentAfterLedgerHook func(*gorm.DB) error
	stripePaymentAfterWalletHook func(*gorm.DB) error
	stripePaymentAfterOrderHook  func(*gorm.DB) error
	stripePaymentBeforeAuditHook func(*gorm.DB) error
)

func newStripeOpaqueID(prefix string) (string, error) {
	var raw [24]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(raw[:]), nil
}

func CreateStripePaymentOrder(order *StripePaymentOrder) error {
	if order == nil || order.UserId <= 0 || order.ExpectedAmountMinor <= 0 || order.Currency == "" {
		return errors.New("invalid stripe payment order")
	}
	if order.OrderKind != StripeOrderKindTopUp && order.OrderKind != StripeOrderKindSubscription {
		return errors.New("invalid stripe order kind")
	}
	return DB.Create(order).Error
}

func CreateStripeTopUpOrder(order *StripePaymentOrder, topUp *TopUp) error {
	if order == nil || topUp == nil || order.OrderKind != StripeOrderKindTopUp {
		return errors.New("invalid stripe topup order")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(order).Error; err != nil {
			return err
		}
		topUp.TradeNo = order.OrderNo
		topUp.UserId = order.UserId
		topUp.PaymentMethod = PaymentMethodStripe
		topUp.PaymentProvider = PaymentProviderStripe
		topUp.Status = common.TopUpStatusPending
		if topUp.CreateTime == 0 {
			topUp.CreateTime = order.CreatedAt
		}
		if err := tx.Create(topUp).Error; err != nil {
			return err
		}
		order.LegacyTopUpId = topUp.Id
		return tx.Model(&StripePaymentOrder{}).Where("id = ?", order.Id).
			Update("legacy_top_up_id", topUp.Id).Error
	})
}

func CreateStripeSubscriptionOrder(order *StripePaymentOrder, legacy *SubscriptionOrder) error {
	if order == nil || legacy == nil || order.OrderKind != StripeOrderKindSubscription {
		return errors.New("invalid stripe subscription order")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(order).Error; err != nil {
			return err
		}
		legacy.TradeNo = order.OrderNo
		legacy.UserId = order.UserId
		legacy.PlanId = order.PlanId
		legacy.PaymentMethod = PaymentMethodStripe
		legacy.PaymentProvider = PaymentProviderStripe
		legacy.Status = common.TopUpStatusPending
		if legacy.CreateTime == 0 {
			legacy.CreateTime = order.CreatedAt
		}
		if err := tx.Create(legacy).Error; err != nil {
			return err
		}
		order.LegacySubscriptionOrder = legacy.Id
		return tx.Model(&StripePaymentOrder{}).Where("id = ?", order.Id).
			Update("legacy_subscription_order", legacy.Id).Error
	})
}

func BindStripeCheckoutSession(orderNo, sessionID, paymentIntentID, customerID, checkoutURL string, livemode bool) error {
	if orderNo == "" || sessionID == "" {
		return errors.New("invalid stripe checkout binding")
	}
	sessionID = strings.TrimSpace(sessionID)
	paymentIntentID = strings.TrimSpace(paymentIntentID)
	customerID = strings.TrimSpace(customerID)
	checkoutURL = strings.TrimSpace(checkoutURL)
	var bindingConflict bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order StripePaymentOrder
		if err := lockForUpdate(tx).Where("order_no = ?", orderNo).First(&order).Error; err != nil {
			return err
		}
		conflictReason := stripeBindingConflictReason(&order, sessionID, paymentIntentID, customerID, checkoutURL, livemode)
		if conflictReason != "" {
			bindingConflict = true
			now := getDBTimestampTx(tx)
			updateResult := tx.Model(&StripePaymentOrder{}).
				Where("id = ? AND version = ?", order.Id, order.Version).
				Updates(map[string]interface{}{
					"status":       StripeOrderStatusManualReview,
					"last_error":   conflictReason,
					"updated_at":   now,
					"locked_by":    "",
					"locked_until": int64(0),
					"version":      gorm.Expr("version + 1"),
				})
			if updateResult.Error != nil {
				return updateResult.Error
			}
			if updateResult.RowsAffected != 1 {
				return ErrStripeEventLeaseConflict
			}
			return tx.Create(&PaymentAudit{
				OrderNo:        order.OrderNo,
				ActorType:      "system",
				Action:         "checkout_binding_conflict",
				Reason:         conflictReason,
				StatusBefore:   order.Status,
				StatusAfter:    StripeOrderStatusManualReview,
				StripeObjectId: sessionID,
				CreatedAt:      now,
			}).Error
		}
		if order.StripeCheckoutSessionId == sessionID &&
			(order.StripePaymentIntentId != "" || paymentIntentID == "") &&
			(order.StripeCustomerId != "" || customerID == "") &&
			order.Livemode == livemode &&
			(order.CheckoutUrl != "" || checkoutURL == "") {
			return nil
		}
		if order.Status != StripeOrderStatusCreated &&
			order.Status != StripeOrderStatusCheckoutCreated &&
			order.Status != StripeOrderStatusCheckoutBindingFailed {
			return ErrStripePaymentAlreadyFinal
		}
		updates := map[string]interface{}{
			"status":        StripeOrderStatusCheckoutCreated,
			"last_error":    "",
			"attempts":      gorm.Expr("attempts + 1"),
			"next_retry_at": int64(0),
			"locked_by":     "",
			"locked_until":  int64(0),
			"updated_at":    getDBTimestampTx(tx),
			"version":       gorm.Expr("version + 1"),
		}
		if order.StripeCheckoutSessionId == "" {
			updates["stripe_checkout_session_id"] = sessionID
		}
		if order.StripePaymentIntentId == "" && paymentIntentID != "" {
			updates["stripe_payment_intent_id"] = paymentIntentID
		}
		if order.StripeCustomerId == "" && customerID != "" {
			updates["stripe_customer_id"] = customerID
		}
		if order.CheckoutUrl == "" && checkoutURL != "" {
			updates["checkout_url"] = checkoutURL
		}
		result := tx.Model(&StripePaymentOrder{}).
			Where("id = ? AND version = ?", order.Id, order.Version).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrStripeEventLeaseConflict
		}
		return nil
	})
	if err != nil {
		return err
	}
	if bindingConflict {
		return ErrStripeBindingConflict
	}
	return nil
}

func stripeBindingConflictReason(
	order *StripePaymentOrder,
	sessionID, paymentIntentID, customerID, checkoutURL string,
	livemode bool,
) string {
	if order.StripeCheckoutSessionId != "" && order.StripeCheckoutSessionId != sessionID {
		return "checkout session binding conflict"
	}
	if order.StripePaymentIntentId != "" && paymentIntentID != "" && order.StripePaymentIntentId != paymentIntentID {
		return "payment intent binding conflict"
	}
	if order.StripeCustomerId != "" && customerID != "" && order.StripeCustomerId != customerID {
		return "customer binding conflict"
	}
	if order.Livemode != livemode {
		return "livemode binding conflict"
	}
	if order.CheckoutUrl != "" && checkoutURL != "" && order.CheckoutUrl != checkoutURL {
		return "checkout URL binding conflict"
	}
	return ""
}

func MarkStripeCheckoutBindingFailed(orderNo string, cause error) error {
	if orderNo == "" {
		return errors.New("stripe order number is empty")
	}
	message := ""
	if cause != nil {
		message = sanitizeBillingJobError(cause.Error())
	}
	now := common.GetTimestamp()
	result := DB.Model(&StripePaymentOrder{}).
		Where("order_no = ? AND status IN ?", orderNo, []string{StripeOrderStatusCreated, StripeOrderStatusCheckoutBindingFailed}).
		Updates(map[string]interface{}{
			"status":        StripeOrderStatusCheckoutBindingFailed,
			"last_error":    message,
			"failed_at":     now,
			"attempts":      gorm.Expr("attempts + 1"),
			"next_retry_at": now + 5,
			"locked_by":     "",
			"locked_until":  int64(0),
			"updated_at":    now,
			"version":       gorm.Expr("version + 1"),
		})
	return result.Error
}

func GetStripePaymentOrder(orderNo string) (*StripePaymentOrder, error) {
	var order StripePaymentOrder
	if err := DB.Where("order_no = ?", orderNo).First(&order).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

func MarkStripeOrderCreditRetry(orderNo, eventID string, cause error) error {
	if orderNo == "" {
		return nil
	}
	message := "temporary stripe credit failure"
	if cause != nil {
		message = sanitizeBillingJobError(cause.Error())
	}
	now := common.GetTimestamp()
	return DB.Model(&StripePaymentOrder{}).
		Where("order_no = ? AND status <> ?", orderNo, StripeOrderStatusCredited).
		Updates(map[string]interface{}{
			"status":               StripeOrderStatusCreditFailed,
			"last_stripe_event_id": eventID,
			"last_error":           message,
			"next_retry_at":        now + 5,
			"updated_at":           now,
			"version":              gorm.Expr("version + 1"),
		}).Error
}

func MarkStripeOrderPaidPending(orderNo, eventID string) error {
	if orderNo == "" || eventID == "" {
		return nil
	}
	now := common.GetTimestamp()
	return DB.Model(&StripePaymentOrder{}).
		Where("order_no = ? AND status NOT IN ?", orderNo, []string{
			StripeOrderStatusCredited,
			StripeOrderStatusRefunded,
			StripeOrderStatusCancelled,
			StripeOrderStatusManualReview,
		}).
		Updates(map[string]interface{}{
			"status":               StripeOrderStatusPaidPendingCredit,
			"last_stripe_event_id": eventID,
			"last_error":           "",
			"next_retry_at":        now,
			"updated_at":           now,
			"version":              gorm.Expr("version + 1"),
		}).Error
}

func RecordStripeWebhookEvent(incoming *StripeWebhookEvent) (*StripeWebhookEvent, bool, error) {
	if incoming == nil || incoming.StripeEventId == "" || incoming.PayloadDigest == "" || incoming.EventType == "" {
		return nil, false, errors.New("invalid stripe webhook event")
	}
	err := DB.Create(incoming).Error
	if err == nil {
		return incoming, true, nil
	}
	var existing StripeWebhookEvent
	if queryErr := DB.Where("stripe_event_id = ?", incoming.StripeEventId).First(&existing).Error; queryErr != nil {
		return nil, false, err
	}
	if existing.PayloadDigest != incoming.PayloadDigest ||
		existing.EventType != incoming.EventType ||
		existing.Livemode != incoming.Livemode {
		_ = DB.Model(&StripeWebhookEvent{}).Where("id = ?", existing.Id).Updates(map[string]interface{}{
			"status":     StripeEventStatusManualReview,
			"last_error": "event id replayed with conflicting payload",
			"updated_at": common.GetTimestamp(),
			"version":    gorm.Expr("version + 1"),
		}).Error
		return &existing, false, ErrStripeEventConflict
	}
	return &existing, false, nil
}

func MarkStripeEventIgnored(eventID string) error {
	now := common.GetTimestamp()
	return DB.Model(&StripeWebhookEvent{}).
		Where("stripe_event_id = ? AND status NOT IN ?", eventID, []string{StripeEventStatusProcessed, StripeEventStatusManualReview}).
		Updates(map[string]interface{}{
			"status":       StripeEventStatusIgnored,
			"processed_at": now,
			"updated_at":   now,
			"last_error":   "",
			"locked_by":    "",
			"locked_until": int64(0),
			"version":      gorm.Expr("version + 1"),
		}).Error
}

func MarkStripeEventRetry(eventID string, cause error) error {
	message := "temporary stripe payment processing failure"
	if cause != nil {
		message = sanitizeBillingJobError(cause.Error())
	}
	now := common.GetTimestamp()
	return DB.Model(&StripeWebhookEvent{}).
		Where("stripe_event_id = ? AND status NOT IN ?", eventID,
			[]string{StripeEventStatusProcessed, StripeEventStatusIgnored, StripeEventStatusRejected, StripeEventStatusManualReview}).
		Updates(map[string]interface{}{
			"status":        StripeEventStatusCreditFailed,
			"last_error":    message,
			"next_retry_at": now + 5,
			"updated_at":    now,
			"locked_by":     "",
			"locked_until":  int64(0),
			"version":       gorm.Expr("version + 1"),
		}).Error
}

func rejectStripeEventTx(tx *gorm.DB, event *StripeWebhookEvent, order *StripePaymentOrder, status, reason string) error {
	now := getDBTimestampTx(tx)
	if status == "" {
		status = StripeEventStatusRejected
	}
	if err := tx.Model(&StripeWebhookEvent{}).Where("id = ?", event.Id).Updates(map[string]interface{}{
		"status":       status,
		"last_error":   reason,
		"processed_at": now,
		"updated_at":   now,
		"locked_by":    "",
		"locked_until": int64(0),
		"version":      gorm.Expr("version + 1"),
	}).Error; err != nil {
		return err
	}
	if order != nil && order.Status != StripeOrderStatusCredited {
		if err := tx.Model(&StripePaymentOrder{}).Where("id = ?", order.Id).Updates(map[string]interface{}{
			"status":     StripeOrderStatusManualReview,
			"last_error": reason,
			"updated_at": now,
			"version":    gorm.Expr("version + 1"),
		}).Error; err != nil {
			return err
		}
	}
	return tx.Create(&PaymentAudit{
		OrderNo:        event.OrderNo,
		StripeEventId:  event.StripeEventId,
		ActorType:      "stripe",
		Action:         "payment_rejected",
		Reason:         reason,
		StatusAfter:    status,
		StripeObjectId: event.StripeObjectId,
	}).Error
}

func validateStripeEventOrder(event *StripeWebhookEvent, order *StripePaymentOrder) string {
	if order.Provider != PaymentProviderStripe {
		return "payment provider mismatch"
	}
	if event.OrderNo == "" || event.OrderNo != order.OrderNo {
		return "order number mismatch"
	}
	if event.Livemode != order.Livemode {
		return "livemode mismatch"
	}
	if event.AmountMinor != order.ExpectedAmountMinor {
		return "payment amount mismatch"
	}
	if strings.ToLower(event.Currency) != strings.ToLower(order.Currency) {
		return "payment currency mismatch"
	}
	if event.CheckoutSessionId != "" && order.StripeCheckoutSessionId != "" &&
		event.CheckoutSessionId != order.StripeCheckoutSessionId {
		return "checkout session mismatch"
	}
	if event.PaymentIntentId != "" && order.StripePaymentIntentId != "" &&
		event.PaymentIntentId != order.StripePaymentIntentId {
		return "payment intent mismatch"
	}
	if event.CustomerId != "" && order.StripeCustomerId != "" &&
		event.CustomerId != order.StripeCustomerId {
		return "stripe customer mismatch"
	}
	return ""
}

func validateStripeFailureEventOrder(event *StripeWebhookEvent, order *StripePaymentOrder, refund bool) string {
	if order.Provider != PaymentProviderStripe {
		return "payment provider mismatch"
	}
	if event.OrderNo == "" || event.OrderNo != order.OrderNo {
		return "order number mismatch"
	}
	if event.Livemode != order.Livemode {
		return "livemode mismatch"
	}
	if event.AmountMinor > 0 && event.AmountMinor != order.ExpectedAmountMinor {
		return "payment amount mismatch"
	}
	if event.Currency != "" && !strings.EqualFold(event.Currency, order.Currency) {
		return "payment currency mismatch"
	}
	if refund {
		return ""
	}
	if event.CheckoutSessionId != "" {
		if order.StripeCheckoutSessionId == "" || event.CheckoutSessionId != order.StripeCheckoutSessionId {
			return "checkout session mismatch"
		}
		return ""
	}
	if event.PaymentIntentId != "" {
		if order.StripePaymentIntentId == "" || event.PaymentIntentId != order.StripePaymentIntentId {
			return "payment intent mismatch"
		}
		return ""
	}
	return "stripe failure event has no bound payment object"
}

func ProcessStripeSuccessfulEvent(stripeEventID string) (*StripeEventProcessingResult, error) {
	return ProcessStripeSuccessfulEventWithActor(stripeEventID, StripePaymentActor{Type: "stripe"})
}

func ProcessStripeSuccessfulEventWithActor(stripeEventID string, actor StripePaymentActor) (*StripeEventProcessingResult, error) {
	result := &StripeEventProcessingResult{}
	if actor.Type == "" {
		actor.Type = "stripe"
	}
	actor.Reason = strings.TrimSpace(actor.Reason)
	err := DB.Transaction(func(tx *gorm.DB) error {
		var event StripeWebhookEvent
		if err := lockForUpdate(tx).Where("stripe_event_id = ?", stripeEventID).First(&event).Error; err != nil {
			return err
		}
		result.OrderNo = event.OrderNo
		if event.Status == StripeEventStatusProcessed || event.Status == StripeEventStatusIgnored {
			result.Disposition = event.Status
			return nil
		}
		var order StripePaymentOrder
		if err := lockForUpdate(tx).Where("order_no = ?", event.OrderNo).First(&order).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return rejectStripeEventTx(tx, &event, nil, StripeEventStatusRejected, "local stripe order not found")
			}
			return err
		}
		result.UserId = order.UserId
		if reason := validateStripeEventOrder(&event, &order); reason != "" {
			result.Disposition = StripeEventStatusManualReview
			return rejectStripeEventTx(tx, &event, &order, StripeEventStatusManualReview, reason)
		}
		if event.PaymentStatus != "paid" && event.PaymentStatus != "succeeded" {
			now := getDBTimestampTx(tx)
			if err := tx.Model(&StripeWebhookEvent{}).Where("id = ?", event.Id).Updates(map[string]interface{}{
				"status":       StripeEventStatusProcessed,
				"processed_at": now,
				"updated_at":   now,
				"last_error":   "payment not yet paid",
				"version":      gorm.Expr("version + 1"),
			}).Error; err != nil {
				return err
			}
			result.Disposition = StripeEventStatusProcessed
			return nil
		}
		if order.Status == StripeOrderStatusRefunded || order.Status == StripeOrderStatusCancelled {
			result.Disposition = StripeEventStatusManualReview
			return rejectStripeEventTx(tx, &event, &order, StripeEventStatusManualReview, "paid event received for closed order")
		}

		now := getDBTimestampTx(tx)
		operationKey := "stripe:credit:" + order.OrderNo
		var existingLedger PaymentCreditLedger
		ledgerQuery := lockForUpdate(tx).Where("operation_key = ? OR order_no = ?", operationKey, order.OrderNo).
			Limit(1).Find(&existingLedger)
		if ledgerQuery.Error != nil {
			return ledgerQuery.Error
		}
		if ledgerQuery.RowsAffected == 1 {
			matches := existingLedger.OperationKey == operationKey &&
				existingLedger.OrderNo == order.OrderNo &&
				existingLedger.UserId == order.UserId &&
				existingLedger.OrderKind == order.OrderKind &&
				existingLedger.AmountMinor == order.ExpectedAmountMinor &&
				strings.EqualFold(existingLedger.Currency, order.Currency) &&
				existingLedger.CreditedQuota == order.CreditedQuota
			if !matches {
				result.Disposition = StripeEventStatusManualReview
				return rejectStripeEventTx(tx, &event, &order, StripeEventStatusManualReview, "payment credit ledger conflict")
			}
			if order.Status != StripeOrderStatusCredited {
				result.Disposition = StripeEventStatusManualReview
				return rejectStripeEventTx(tx, &event, &order, StripeEventStatusManualReview, "payment ledger and order require reconciliation")
			}
			if err := markStripeEventProcessedTx(tx, &event, now); err != nil {
				return err
			}
			if actor.Type == "admin" {
				if err := createStripePaymentAuditTx(tx, &order, &event, actor, "payment_credit_idempotent", order.Status, order.Status, now); err != nil {
					return err
				}
			}
			result.Disposition = StripeEventStatusProcessed
			return nil
		}
		if order.Status == StripeOrderStatusCredited {
			result.Disposition = StripeEventStatusManualReview
			return rejectStripeEventTx(tx, &event, &order, StripeEventStatusManualReview, "credited order is missing payment ledger")
		}

		var user User
		if err := lockForUpdate(tx).First(&user, order.UserId).Error; err != nil {
			return err
		}
		walletBefore := int64(user.Quota)
		walletAfter := walletBefore
		if order.OrderKind == StripeOrderKindTopUp {
			if order.CreditedQuota <= 0 {
				return errors.New("stripe order has invalid credited quota")
			}
			walletAfter += order.CreditedQuota
		} else if order.OrderKind != StripeOrderKindSubscription {
			return errors.New("unsupported stripe order kind")
		}

		ledger := &PaymentCreditLedger{
			OperationKey:  operationKey,
			OrderNo:       order.OrderNo,
			StripeEventId: event.StripeEventId,
			UserId:        order.UserId,
			OrderKind:     order.OrderKind,
			AmountMinor:   order.ExpectedAmountMinor,
			Currency:      order.Currency,
			CreditedQuota: order.CreditedQuota,
			WalletBefore:  walletBefore,
			WalletAfter:   walletAfter,
			CreatedAt:     now,
		}
		if err := tx.Create(ledger).Error; err != nil {
			return fmt.Errorf("create payment credit ledger: %w", err)
		}
		if stripePaymentAfterLedgerHook != nil {
			if err := stripePaymentAfterLedgerHook(tx); err != nil {
				return err
			}
		}

		switch order.OrderKind {
		case StripeOrderKindTopUp:
			userUpdates := map[string]interface{}{
				"quota": gorm.Expr("quota + ?", order.CreditedQuota),
			}
			if event.CustomerId != "" {
				userUpdates["stripe_customer"] = event.CustomerId
			}
			if err := tx.Model(&User{}).Where("id = ?", order.UserId).Updates(userUpdates).Error; err != nil {
				return err
			}
			if stripePaymentAfterWalletHook != nil {
				if err := stripePaymentAfterWalletHook(tx); err != nil {
					return err
				}
			}
			var topUp TopUp
			if err := lockForUpdate(tx).Where("trade_no = ?", order.OrderNo).First(&topUp).Error; err != nil {
				return err
			}
			topUp.Status = common.TopUpStatusSuccess
			topUp.CompleteTime = now
			if err := tx.Save(&topUp).Error; err != nil {
				return err
			}
			if _, _, err := registerFirstTopUpReferralTx(tx, order.UserId, order.CreditedQuota); err != nil {
				return err
			}
		case StripeOrderKindSubscription:
			var legacy SubscriptionOrder
			if err := lockForUpdate(tx).Where("trade_no = ?", order.OrderNo).First(&legacy).Error; err != nil {
				return err
			}
			if legacy.Status != common.TopUpStatusPending && legacy.Status != common.TopUpStatusSuccess {
				return ErrSubscriptionOrderStatusInvalid
			}
			var plan SubscriptionPlan
			if err := tx.First(&plan, legacy.PlanId).Error; err != nil {
				return err
			}
			if legacy.Status != common.TopUpStatusSuccess {
				if _, err := CreateUserSubscriptionFromPlanTx(tx, legacy.UserId, &plan, "order"); err != nil {
					return err
				}
				legacy.Status = common.TopUpStatusSuccess
				legacy.CompleteTime = now
				legacy.ProviderPayload = fmt.Sprintf(`{"stripe_event_id":%q,"stripe_object_id":%q}`, event.StripeEventId, event.StripeObjectId)
				if err := tx.Save(&legacy).Error; err != nil {
					return err
				}
				if err := upsertSubscriptionTopUpTx(tx, &legacy); err != nil {
					return err
				}
			}
		}

		orderBefore := order.Status
		if err := tx.Model(&StripePaymentOrder{}).Where("id = ?", order.Id).Updates(map[string]interface{}{
			"status":                     StripeOrderStatusCredited,
			"stripe_payment_intent_id":   firstNonEmptyStripeValue(order.StripePaymentIntentId, event.PaymentIntentId),
			"stripe_customer_id":         firstNonEmptyStripeValue(order.StripeCustomerId, event.CustomerId),
			"stripe_checkout_session_id": firstNonEmptyStripeValue(order.StripeCheckoutSessionId, event.CheckoutSessionId),
			"paid_at":                    now,
			"credited_at":                now,
			"last_stripe_event_id":       event.StripeEventId,
			"last_error":                 "",
			"next_retry_at":              int64(0),
			"locked_by":                  "",
			"locked_until":               int64(0),
			"updated_at":                 now,
			"version":                    gorm.Expr("version + 1"),
		}).Error; err != nil {
			return err
		}
		if stripePaymentAfterOrderHook != nil {
			if err := stripePaymentAfterOrderHook(tx); err != nil {
				return err
			}
		}
		if err := markStripeEventProcessedTx(tx, &event, now); err != nil {
			return err
		}
		if stripePaymentBeforeAuditHook != nil {
			if err := stripePaymentBeforeAuditHook(tx); err != nil {
				return err
			}
		}
		if err := createStripePaymentAuditTx(tx, &order, &event, actor, "payment_credited", orderBefore, StripeOrderStatusCredited, now); err != nil {
			return err
		}
		result.Disposition = StripeEventStatusProcessed
		result.Credited = true
		return nil
	})
	return result, err
}

func markStripeEventProcessedTx(tx *gorm.DB, event *StripeWebhookEvent, now int64) error {
	return tx.Model(&StripeWebhookEvent{}).Where("id = ?", event.Id).Updates(map[string]interface{}{
		"status":       StripeEventStatusProcessed,
		"processed_at": now,
		"updated_at":   now,
		"last_error":   "",
		"locked_by":    "",
		"locked_until": int64(0),
		"version":      gorm.Expr("version + 1"),
	}).Error
}

func createStripePaymentAuditTx(tx *gorm.DB, order *StripePaymentOrder, event *StripeWebhookEvent, actor StripePaymentActor, action, before, after string, now int64) error {
	return tx.Create(&PaymentAudit{
		OrderNo:        order.OrderNo,
		StripeEventId:  event.StripeEventId,
		ActorType:      actor.Type,
		ActorId:        actor.Id,
		Action:         action,
		Reason:         actor.Reason,
		StatusBefore:   before,
		StatusAfter:    after,
		StripeObjectId: event.StripeObjectId,
		CreatedAt:      now,
	}).Error
}

func ProcessStripeFailureEvent(stripeEventID string, refund bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var event StripeWebhookEvent
		if err := lockForUpdate(tx).Where("stripe_event_id = ?", stripeEventID).First(&event).Error; err != nil {
			return err
		}
		if event.Status == StripeEventStatusProcessed || event.Status == StripeEventStatusManualReview {
			return nil
		}
		var order StripePaymentOrder
		if err := lockForUpdate(tx).Where("order_no = ?", event.OrderNo).First(&order).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if refund {
					return rejectStripeEventTx(tx, &event, nil, StripeEventStatusManualReview, "unmatched Stripe refund requires manual review")
				}
				return rejectStripeEventTx(tx, &event, nil, StripeEventStatusRejected, "local stripe order not found")
			}
			return err
		}
		if reason := validateStripeFailureEventOrder(&event, &order, refund); reason != "" {
			return rejectStripeEventTx(tx, &event, &order, StripeEventStatusManualReview, reason)
		}
		if refund {
			return rejectStripeEventTx(tx, &event, &order, StripeEventStatusManualReview, "stripe refund requires manual accounting review")
		}
		now := getDBTimestampTx(tx)
		if order.Status == StripeOrderStatusCredited {
			return markStripeEventProcessedTx(tx, &event, now)
		}
		if order.Status != StripeOrderStatusCredited {
			if err := tx.Model(&StripePaymentOrder{}).Where("id = ?", order.Id).Updates(map[string]interface{}{
				"status":     StripeOrderStatusPaymentFailed,
				"failed_at":  now,
				"last_error": "stripe reported payment failure",
				"updated_at": now,
				"version":    gorm.Expr("version + 1"),
			}).Error; err != nil {
				return err
			}
		}
		return tx.Model(&StripeWebhookEvent{}).Where("id = ?", event.Id).Updates(map[string]interface{}{
			"status":       StripeEventStatusProcessed,
			"processed_at": now,
			"updated_at":   now,
			"last_error":   "",
			"version":      gorm.Expr("version + 1"),
		}).Error
	})
}

func ClaimStripeWebhookEvent(workerID string, now time.Time, lease time.Duration) (*StripeWebhookEvent, error) {
	if workerID == "" || lease <= 0 {
		return nil, errors.New("invalid stripe worker lease")
	}
	nowUnix := now.Unix()
	statuses := []string{StripeEventStatusReceived, StripeEventStatusRetry, StripeEventStatusCreditFailed, StripeEventStatusProcessing}
	for attempt := 0; attempt < 8; attempt++ {
		var candidate StripeWebhookEvent
		query := DB.Where(
			"status IN ? AND next_retry_at <= ? AND (locked_until = 0 OR locked_until <= ?)",
			statuses, nowUnix, nowUnix,
		).Order("next_retry_at asc, id asc").Limit(1).Find(&candidate)
		if query.Error != nil {
			return nil, query.Error
		}
		if query.RowsAffected == 0 {
			return nil, nil
		}
		update := DB.Model(&StripeWebhookEvent{}).
			Where("id = ? AND version = ? AND status IN ? AND (locked_until = 0 OR locked_until <= ?)",
				candidate.Id, candidate.Version, statuses, nowUnix).
			Updates(map[string]interface{}{
				"status":       StripeEventStatusProcessing,
				"attempts":     gorm.Expr("attempts + 1"),
				"locked_by":    workerID,
				"locked_until": now.Add(lease).Unix(),
				"updated_at":   nowUnix,
				"version":      gorm.Expr("version + 1"),
			})
		if update.Error != nil {
			return nil, update.Error
		}
		if update.RowsAffected != 1 {
			continue
		}
		if err := DB.First(&candidate, candidate.Id).Error; err != nil {
			return nil, err
		}
		return &candidate, nil
	}
	return nil, nil
}

func ClaimStripePaymentOrder(workerID string, now time.Time, lease time.Duration) (*StripePaymentOrder, error) {
	if workerID == "" || lease <= 0 {
		return nil, errors.New("invalid stripe order worker lease")
	}
	nowUnix := now.Unix()
	statuses := []string{
		StripeOrderStatusCreated,
		StripeOrderStatusCheckoutBindingFailed,
		StripeOrderStatusPaidPendingCredit,
		StripeOrderStatusCreditFailed,
	}
	for attempt := 0; attempt < 8; attempt++ {
		var candidate StripePaymentOrder
		query := DB.Where(
			"status IN ? AND next_retry_at <= ? AND (locked_until = 0 OR locked_until <= ?)",
			statuses, nowUnix, nowUnix,
		).Order("next_retry_at asc, id asc").Limit(1).Find(&candidate)
		if query.Error != nil {
			return nil, query.Error
		}
		if query.RowsAffected == 0 {
			return nil, nil
		}
		update := DB.Model(&StripePaymentOrder{}).
			Where("id = ? AND version = ? AND status IN ? AND next_retry_at <= ? AND (locked_until = 0 OR locked_until <= ?)",
				candidate.Id, candidate.Version, statuses, nowUnix, nowUnix).
			Updates(map[string]interface{}{
				"attempts":     gorm.Expr("attempts + 1"),
				"locked_by":    workerID,
				"locked_until": now.Add(lease).Unix(),
				"updated_at":   nowUnix,
				"version":      gorm.Expr("version + 1"),
			})
		if update.Error != nil {
			return nil, update.Error
		}
		if update.RowsAffected != 1 {
			continue
		}
		if err := DB.First(&candidate, candidate.Id).Error; err != nil {
			return nil, err
		}
		return &candidate, nil
	}
	return nil, nil
}

func FailClaimedStripeOrder(order *StripePaymentOrder, workerID string, cause error, now time.Time) error {
	if order == nil {
		return errors.New("stripe payment order is nil")
	}
	status := order.Status
	if status == StripeOrderStatusCreated {
		status = StripeOrderStatusCheckoutBindingFailed
	}
	nextRetry := now.Add(time.Duration(order.Attempts+1) * 15 * time.Second).Unix()
	if order.Attempts >= order.MaxAttempts {
		status = StripeOrderStatusManualReview
		nextRetry = 0
	}
	result := DB.Model(&StripePaymentOrder{}).
		Where("id = ? AND locked_by = ?", order.Id, workerID).
		Updates(map[string]interface{}{
			"status":        status,
			"last_error":    sanitizeBillingJobError(cause.Error()),
			"next_retry_at": nextRetry,
			"locked_by":     "",
			"locked_until":  int64(0),
			"updated_at":    now.Unix(),
			"version":       gorm.Expr("version + 1"),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrStripeEventLeaseConflict
	}
	return nil
}

func FailClaimedStripeEvent(event *StripeWebhookEvent, workerID string, cause error, now time.Time) error {
	if event == nil {
		return errors.New("stripe event is nil")
	}
	status := StripeEventStatusRetry
	nextRetry := now.Add(time.Duration(event.Attempts+1) * 15 * time.Second).Unix()
	if event.Attempts >= event.MaxAttempts {
		status = StripeEventStatusManualReview
		nextRetry = 0
	}
	result := DB.Model(&StripeWebhookEvent{}).
		Where("id = ? AND status = ? AND locked_by = ?", event.Id, StripeEventStatusProcessing, workerID).
		Updates(map[string]interface{}{
			"status":        status,
			"last_error":    sanitizeBillingJobError(cause.Error()),
			"next_retry_at": nextRetry,
			"locked_by":     "",
			"locked_until":  int64(0),
			"updated_at":    now.Unix(),
			"version":       gorm.Expr("version + 1"),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrStripeEventLeaseConflict
	}
	return nil
}

func firstNonEmptyStripeValue(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
