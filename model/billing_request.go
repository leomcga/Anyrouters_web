package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	BillingRequestStatusReserved          = "reserved"
	BillingRequestStatusSettlementPending = "settlement_pending"
	BillingRequestStatusSettled           = "settled"
	BillingRequestStatusRefundPending     = "refund_pending"
	BillingRequestStatusRefunded          = "refunded"
	BillingRequestStatusSettlementFailed  = "settlement_failed"
	BillingRequestStatusRefundFailed      = "refund_failed"
	BillingRequestStatusManualReview      = "manual_review"
)

var (
	ErrBillingRequestConflict   = errors.New("billing request conflict")
	ErrBillingStateConflict     = errors.New("billing request state conflict")
	ErrBillingRequestNotFound   = errors.New("billing request not found")
	ErrBillingInvalidTransition = errors.New("invalid billing request state transition")
)

type BillingRequest struct {
	Id             int64  `json:"id" gorm:"primaryKey"`
	RequestId      string `json:"request_id" gorm:"type:varchar(64);not null;uniqueIndex:idx_billing_requests_request_id"`
	FundingSource  string `json:"funding_source" gorm:"type:varchar(32);not null;index:idx_billing_requests_funding_source"`
	UserId         int    `json:"user_id" gorm:"not null;index:idx_billing_requests_user_id"`
	TokenId        int    `json:"token_id" gorm:"not null;default:0;index:idx_billing_requests_token_id"`
	SubscriptionId int    `json:"subscription_id" gorm:"not null;default:0;index:idx_billing_requests_subscription_id"`
	TokenUnlimited bool   `json:"token_unlimited" gorm:"not null;default:false"`
	Status         string `json:"status" gorm:"type:varchar(32);not null;index:idx_billing_requests_status"`
	ReservedQuota  int64  `json:"reserved_quota" gorm:"type:bigint;not null;default:0"`
	ActualQuota    int64  `json:"actual_quota" gorm:"type:bigint;not null;default:0"`
	RefundedQuota  int64  `json:"refunded_quota" gorm:"type:bigint;not null;default:0"`
	Version        int64  `json:"version" gorm:"type:bigint;not null;default:1"`
	CreatedAt      int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt      int64  `json:"updated_at" gorm:"type:bigint;not null;index:idx_billing_requests_updated_at"`
}

func (r *BillingRequest) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	if r.Status == "" {
		r.Status = BillingRequestStatusReserved
	}
	if r.Version == 0 {
		r.Version = 1
	}
	if r.CreatedAt == 0 {
		r.CreatedAt = now
	}
	if r.UpdatedAt == 0 {
		r.UpdatedAt = now
	}
	return nil
}

func (*BillingRequest) BeforeUpdate(tx *gorm.DB) error {
	if allowed, ok := tx.Get("billing:allow_request_update"); !ok || allowed != true {
		return ErrBillingInvalidTransition
	}
	return nil
}

type BillingReserveParams struct {
	RequestID      string
	FundingSource  string
	UserID         int
	TokenID        int
	TokenKey       string
	TokenUnlimited bool
	SubscriptionID int
	TargetQuota    int64
	SkipToken      bool
}

type BillingAdjustmentParams struct {
	OperationKey   string
	RequestID      string
	FundingSource  string
	UserID         int
	TokenID        int
	TokenKey       string
	SubscriptionID int
	Delta          int64
	SkipToken      bool
}

type BillingMutationResult struct {
	Request           BillingRequest
	LedgerID          int64
	WalletBefore      int64
	WalletAfter       int64
	TokenRemainBefore int64
	TokenRemainAfter  int64
	TokenUsedBefore   int64
	TokenUsedAfter    int64
	SubscriptionTotal int64
	SubscriptionUsed  int64
	AppliedDelta      int64
	Idempotent        bool
}

type billingSnapshot struct {
	walletBefore           int64
	walletAfter            int64
	tokenRemainBefore      int64
	tokenRemainAfter       int64
	tokenUsedBefore        int64
	tokenUsedAfter         int64
	subscriptionUsedBefore int64
	subscriptionUsedAfter  int64
}

var billingAllowedTransitions = map[string]map[string]bool{
	BillingRequestStatusReserved: {
		BillingRequestStatusSettlementPending: true,
		BillingRequestStatusSettled:           true,
		BillingRequestStatusSettlementFailed:  true,
		BillingRequestStatusRefundPending:     true,
		BillingRequestStatusRefunded:          true,
		BillingRequestStatusRefundFailed:      true,
		BillingRequestStatusManualReview:      true,
	},
	BillingRequestStatusSettlementPending: {
		BillingRequestStatusSettled:          true,
		BillingRequestStatusSettlementFailed: true,
		BillingRequestStatusManualReview:     true,
	},
	BillingRequestStatusSettlementFailed: {
		BillingRequestStatusSettlementPending: true,
		BillingRequestStatusSettled:           true,
		BillingRequestStatusManualReview:      true,
	},
	BillingRequestStatusRefundPending: {
		BillingRequestStatusRefunded:     true,
		BillingRequestStatusRefundFailed: true,
		BillingRequestStatusManualReview: true,
	},
	BillingRequestStatusRefundFailed: {
		BillingRequestStatusRefundPending: true,
		BillingRequestStatusRefunded:      true,
		BillingRequestStatusManualReview:  true,
	},
}

func canTransitionBillingRequest(from string, to string) bool {
	if from == to {
		return true
	}
	return billingAllowedTransitions[from][to]
}

func validateBillingIdentity(request *BillingRequest, fundingSource string, userID int, tokenID int, tokenUnlimited bool) error {
	if request == nil {
		return ErrBillingRequestNotFound
	}
	if request.FundingSource != fundingSource ||
		request.UserId != userID ||
		request.TokenId != tokenID ||
		request.TokenUnlimited != tokenUnlimited {
		return ErrBillingRequestConflict
	}
	return nil
}

func normalizeBillingReserveParams(params *BillingReserveParams) error {
	params.RequestID = strings.TrimSpace(params.RequestID)
	params.FundingSource = strings.TrimSpace(params.FundingSource)
	if params.RequestID == "" || len(params.RequestID) > 64 {
		return errors.New("invalid billing request id")
	}
	if params.FundingSource != BillingFundingSourceWallet &&
		params.FundingSource != BillingFundingSourceSubscription {
		return errors.New("invalid billing funding source")
	}
	if params.UserID <= 0 {
		return errors.New("invalid billing user id")
	}
	if !params.SkipToken && params.TokenID <= 0 {
		return errors.New("invalid billing token id")
	}
	if params.TargetQuota < 0 {
		return errors.New("billing target quota must not be negative")
	}
	return nil
}

func billingReserveOperationKey(requestID string, targetQuota int64) string {
	return fmt.Sprintf("%s:%s:%d", requestID, BillingOperationReserve, targetQuota)
}

func billingTerminalOperationKey(requestID string, operation string) string {
	return requestID + ":" + operation
}
