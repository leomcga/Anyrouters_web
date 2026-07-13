package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	BillingOperationReserve    = "reserve"
	BillingOperationSettle     = "settle"
	BillingOperationRefund     = "refund"
	BillingOperationAdjustment = "adjustment"

	BillingFundingSourceWallet       = "wallet"
	BillingFundingSourceSubscription = "subscription"
)

var (
	ErrInsufficientUserQuota    = errors.New("insufficient user quota")
	ErrInsufficientTokenQuota   = errors.New("insufficient token quota")
	ErrBillingOperationConflict = errors.New("billing operation key conflict")
	ErrBillingLedgerImmutable   = errors.New("billing ledger rows are immutable")
)

// BillingLedger is an immutable record of one committed billing operation.
// Amount is signed: positive values consume quota and negative values return it.
type BillingLedger struct {
	Id                     int64  `json:"id" gorm:"primaryKey"`
	OperationKey           string `json:"operation_key" gorm:"type:varchar(128);not null;uniqueIndex:idx_billing_ledgers_operation_key"`
	RequestId              string `json:"request_id" gorm:"type:varchar(64);not null;index:idx_billing_ledgers_request_id"`
	Operation              string `json:"operation" gorm:"type:varchar(32);not null;index:idx_billing_ledgers_operation"`
	FundingSource          string `json:"funding_source" gorm:"type:varchar(32);not null;index:idx_billing_ledgers_funding_source"`
	UserId                 int    `json:"user_id" gorm:"not null;index:idx_billing_ledgers_user_id"`
	TokenId                int    `json:"token_id" gorm:"not null;default:0;index:idx_billing_ledgers_token_id"`
	SubscriptionId         int    `json:"subscription_id" gorm:"not null;default:0;index:idx_billing_ledgers_subscription_id"`
	Amount                 int64  `json:"amount" gorm:"type:bigint;not null"`
	TargetQuota            int64  `json:"target_quota" gorm:"type:bigint;not null;default:0"`
	ActualQuota            int64  `json:"actual_quota" gorm:"type:bigint;not null;default:0"`
	WalletBefore           int64  `json:"wallet_before" gorm:"type:bigint;not null"`
	WalletAfter            int64  `json:"wallet_after" gorm:"type:bigint;not null"`
	TokenRemainBefore      int64  `json:"token_remain_before" gorm:"type:bigint;not null;default:0"`
	TokenRemainAfter       int64  `json:"token_remain_after" gorm:"type:bigint;not null;default:0"`
	TokenUsedBefore        int64  `json:"token_used_before" gorm:"type:bigint;not null;default:0"`
	TokenUsedAfter         int64  `json:"token_used_after" gorm:"type:bigint;not null;default:0"`
	TokenUnlimited         bool   `json:"token_unlimited" gorm:"not null;default:false"`
	SubscriptionUsedBefore int64  `json:"subscription_used_before" gorm:"type:bigint;not null;default:0"`
	SubscriptionUsedAfter  int64  `json:"subscription_used_after" gorm:"type:bigint;not null;default:0"`
	RequestStatusBefore    string `json:"request_status_before" gorm:"type:varchar(32);not null"`
	RequestStatusAfter     string `json:"request_status_after" gorm:"type:varchar(32);not null"`
	CreatedAt              int64  `json:"created_at" gorm:"type:bigint;not null;index:idx_billing_ledgers_created_at"`
}

func (l *BillingLedger) BeforeCreate(_ *gorm.DB) error {
	if l.CreatedAt == 0 {
		l.CreatedAt = common.GetTimestamp()
	}
	return nil
}

func (*BillingLedger) BeforeUpdate(*gorm.DB) error {
	return ErrBillingLedgerImmutable
}

func (*BillingLedger) BeforeDelete(*gorm.DB) error {
	return ErrBillingLedgerImmutable
}

func findBillingLedgerByOperationKey(db *gorm.DB, operationKey string) (*BillingLedger, bool, error) {
	var ledger BillingLedger
	query := db.Where("operation_key = ?", operationKey).Limit(1).Find(&ledger)
	if query.Error != nil {
		return nil, false, query.Error
	}
	if query.RowsAffected == 0 {
		return nil, false, nil
	}
	return &ledger, true, nil
}
