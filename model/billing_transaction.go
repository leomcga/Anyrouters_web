package model

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

func ReserveBillingRequest(params BillingReserveParams) (*BillingMutationResult, error) {
	if err := normalizeBillingReserveParams(&params); err != nil {
		return nil, err
	}

	var result BillingMutationResult
	var tokenKey string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", params.UserID).First(&user).Error; err != nil {
			return err
		}

		var token Token
		if !params.SkipToken {
			if err := lockForUpdate(tx).
				Where("id = ? AND user_id = ?", params.TokenID, params.UserID).
				First(&token).Error; err != nil {
				return err
			}
			tokenKey = token.CacheIdentifier()
		}

		var request BillingRequest
		query := lockForUpdate(tx).Where("request_id = ?", params.RequestID).Limit(1).Find(&request)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected == 0 {
			request = BillingRequest{
				RequestId:      params.RequestID,
				FundingSource:  params.FundingSource,
				UserId:         params.UserID,
				TokenId:        params.TokenID,
				TokenUnlimited: !params.SkipToken && token.UnlimitedQuota,
				Status:         BillingRequestStatusReserved,
			}
			if params.SkipToken {
				request.TokenId = 0
			}
			if params.FundingSource == BillingFundingSourceSubscription {
				subscription, err := selectSubscriptionForBillingTx(tx, params.UserID, params.SubscriptionID, params.TargetQuota)
				if err != nil {
					return err
				}
				request.SubscriptionId = subscription.Id
			}
			if err := tx.Create(&request).Error; err != nil {
				return err
			}
		} else {
			expectedTokenUnlimited := request.TokenUnlimited
			if !params.SkipToken {
				expectedTokenUnlimited = token.UnlimitedQuota
			}
			if err := validateBillingIdentity(&request, params.FundingSource, params.UserID, request.TokenId, expectedTokenUnlimited); err != nil {
				return err
			}
			if !params.SkipToken && request.TokenId != params.TokenID {
				return ErrBillingRequestConflict
			}
			if params.SkipToken && request.TokenId != 0 {
				return ErrBillingRequestConflict
			}
			if params.FundingSource == BillingFundingSourceSubscription &&
				params.SubscriptionID > 0 &&
				request.SubscriptionId != params.SubscriptionID {
				return ErrBillingRequestConflict
			}
		}

		if request.Status != BillingRequestStatusReserved {
			return fmt.Errorf("%w: reserve from %s", ErrBillingStateConflict, request.Status)
		}
		if params.TargetQuota <= request.ReservedQuota {
			result = billingResultFromRequest(&request, true)
			result.WalletBefore = int64(user.Quota)
			result.WalletAfter = int64(user.Quota)
			if !params.SkipToken {
				result.TokenRemainBefore = int64(token.RemainQuota)
				result.TokenRemainAfter = int64(token.RemainQuota)
				result.TokenUsedBefore = int64(token.UsedQuota)
				result.TokenUsedAfter = int64(token.UsedQuota)
			}
			return nil
		}

		delta := params.TargetQuota - request.ReservedQuota
		snapshot, err := applyBillingDeltaTx(tx, &request, delta, false)
		if err != nil {
			return err
		}

		operationKey := billingReserveOperationKey(params.RequestID, params.TargetQuota)
		if existing, found, err := findBillingLedgerByOperationKey(tx, operationKey); err != nil {
			return err
		} else if found {
			if !billingLedgerMatchesMutation(existing, &request, BillingOperationReserve, delta, params.TargetQuota, 0) {
				return ErrBillingOperationConflict
			}
			result = billingResultFromLedgerAndRequest(existing, &request, true)
			return nil
		}

		ledger := newBillingLedger(
			operationKey,
			&request,
			BillingOperationReserve,
			delta,
			params.TargetQuota,
			0,
			BillingRequestStatusReserved,
			BillingRequestStatusReserved,
			snapshot,
		)
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}

		if err := updateBillingRequestTx(tx, &request, BillingRequestStatusReserved, map[string]interface{}{
			"reserved_quota": params.TargetQuota,
		}); err != nil {
			return err
		}
		if request.FundingSource == BillingFundingSourceSubscription {
			if err := upsertSubscriptionBillingCompatibilityTx(tx, &request); err != nil {
				return err
			}
		}
		result = billingResultFromLedgerAndRequest(&ledger, &request, false)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if result.Request.FundingSource == BillingFundingSourceSubscription && result.Request.SubscriptionId > 0 {
		var subscription UserSubscription
		if queryErr := DB.Select("amount_total", "amount_used").
			Where("id = ?", result.Request.SubscriptionId).
			First(&subscription).Error; queryErr == nil {
			result.SubscriptionTotal = subscription.AmountTotal
			result.SubscriptionUsed = subscription.AmountUsed
		}
	}
	invalidateBillingCaches(params.UserID, tokenKey)
	return &result, nil
}

func SettleBillingRequest(requestID string, actualQuota int64) (*BillingMutationResult, error) {
	if actualQuota < 0 {
		return nil, errors.New("actual quota must not be negative")
	}
	return mutateTerminalBillingRequest(requestID, BillingOperationSettle, actualQuota)
}

func RefundBillingRequest(requestID string) (*BillingMutationResult, error) {
	return mutateTerminalBillingRequest(requestID, BillingOperationRefund, 0)
}

func ApplyBillingAdjustment(params BillingAdjustmentParams) (*BillingMutationResult, error) {
	params.OperationKey = strings.TrimSpace(params.OperationKey)
	params.RequestID = strings.TrimSpace(params.RequestID)
	if params.OperationKey == "" || len(params.OperationKey) > 128 {
		return nil, errors.New("invalid billing adjustment operation key")
	}
	if params.RequestID == "" || len(params.RequestID) > 64 {
		return nil, errors.New("invalid billing adjustment request id")
	}
	if params.FundingSource == "" {
		params.FundingSource = BillingFundingSourceWallet
	}
	if params.FundingSource != BillingFundingSourceWallet &&
		params.FundingSource != BillingFundingSourceSubscription {
		return nil, errors.New("invalid billing funding source")
	}
	if params.UserID <= 0 || (!params.SkipToken && params.TokenID <= 0) {
		return nil, errors.New("invalid billing adjustment identity")
	}
	if params.Delta == 0 {
		return nil, errors.New("billing adjustment delta must not be zero")
	}

	var result BillingMutationResult
	var tokenKey string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", params.UserID).First(&user).Error; err != nil {
			return err
		}
		var token Token
		if !params.SkipToken {
			if err := lockForUpdate(tx).
				Where("id = ? AND user_id = ?", params.TokenID, params.UserID).
				First(&token).Error; err != nil {
				return err
			}
			tokenKey = token.CacheIdentifier()
		}

		var request BillingRequest
		query := lockForUpdate(tx).Where("request_id = ?", params.RequestID).Limit(1).Find(&request)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected == 0 {
			request = BillingRequest{
				RequestId:      params.RequestID,
				FundingSource:  params.FundingSource,
				UserId:         params.UserID,
				TokenId:        params.TokenID,
				TokenUnlimited: !params.SkipToken && token.UnlimitedQuota,
				Status:         BillingRequestStatusReserved,
			}
			if params.SkipToken {
				request.TokenId = 0
			}
			if params.FundingSource == BillingFundingSourceSubscription {
				subscription, err := selectSubscriptionForBillingTx(tx, params.UserID, params.SubscriptionID, params.Delta)
				if err != nil {
					return err
				}
				request.SubscriptionId = subscription.Id
			}
			if err := tx.Create(&request).Error; err != nil {
				return err
			}
		} else {
			expectedUnlimited := request.TokenUnlimited
			if !params.SkipToken {
				expectedUnlimited = token.UnlimitedQuota
			}
			expectedTokenID := params.TokenID
			if params.SkipToken {
				expectedTokenID = 0
			}
			if err := validateBillingIdentity(&request, params.FundingSource, params.UserID, expectedTokenID, expectedUnlimited); err != nil {
				return err
			}
			if request.Status != BillingRequestStatusReserved &&
				request.Status != BillingRequestStatusSettled {
				return fmt.Errorf("%w: adjustment from %s", ErrBillingStateConflict, request.Status)
			}
		}

		if existing, found, err := findBillingLedgerByOperationKey(tx, params.OperationKey); err != nil {
			return err
		} else if found {
			if !billingLedgerMatchesMutation(existing, &request, BillingOperationAdjustment, params.Delta, existing.TargetQuota, existing.ActualQuota) {
				return ErrBillingOperationConflict
			}
			result = billingResultFromLedgerAndRequest(existing, &request, true)
			return nil
		}

		newActualQuota := request.ActualQuota + params.Delta
		if newActualQuota < 0 {
			return errors.New("billing adjustment would make actual quota negative")
		}
		snapshot, err := applyBillingDeltaTx(tx, &request, params.Delta, false)
		if err != nil {
			return err
		}
		ledger := newBillingLedger(
			params.OperationKey,
			&request,
			BillingOperationAdjustment,
			params.Delta,
			request.ReservedQuota,
			newActualQuota,
			request.Status,
			BillingRequestStatusSettled,
			snapshot,
		)
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}
		if err := updateBillingRequestTx(tx, &request, BillingRequestStatusSettled, map[string]interface{}{
			"actual_quota": newActualQuota,
		}); err != nil {
			return err
		}
		result = billingResultFromLedgerAndRequest(&ledger, &request, false)
		return nil
	})
	if err != nil {
		return nil, err
	}
	invalidateBillingCaches(params.UserID, tokenKey)
	return &result, nil
}

func mutateTerminalBillingRequest(requestID string, operation string, actualQuota int64) (*BillingMutationResult, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil, errors.New("billing request id is empty")
	}
	if operation != BillingOperationSettle && operation != BillingOperationRefund {
		return nil, errors.New("invalid terminal billing operation")
	}

	var result BillingMutationResult
	var userID int
	var tokenKey string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var request BillingRequest
		if err := lockForUpdate(tx).Where("request_id = ?", requestID).First(&request).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrBillingRequestNotFound
			}
			return err
		}
		userID = request.UserId

		operationKey := billingTerminalOperationKey(requestID, operation)
		if existing, found, err := findBillingLedgerByOperationKey(tx, operationKey); err != nil {
			return err
		} else if found {
			expectedAmount := int64(0)
			if operation == BillingOperationSettle {
				expectedAmount = actualQuota - request.ReservedQuota
			} else {
				expectedAmount = -request.ReservedQuota
			}
			if !billingLedgerMatchesMutation(existing, &request, operation, expectedAmount, request.ReservedQuota, actualQuota) {
				return ErrBillingOperationConflict
			}
			result = billingResultFromLedgerAndRequest(existing, &request, true)
			return nil
		}

		if request.TokenId > 0 {
			var token Token
			if err := tx.Unscoped().Select("key").Where("id = ?", request.TokenId).First(&token).Error; err == nil {
				tokenKey = token.CacheIdentifier()
			}
		}

		var nextStatus string
		var delta int64
		switch operation {
		case BillingOperationSettle:
			if request.Status == BillingRequestStatusSettled {
				if request.ActualQuota == actualQuota {
					result = billingResultFromRequest(&request, true)
					return nil
				}
				return ErrBillingOperationConflict
			}
			if request.Status == BillingRequestStatusRefunded ||
				request.Status == BillingRequestStatusRefundPending ||
				request.Status == BillingRequestStatusRefundFailed {
				return fmt.Errorf("%w: settle from %s", ErrBillingStateConflict, request.Status)
			}
			if request.Status != BillingRequestStatusReserved &&
				request.Status != BillingRequestStatusSettlementPending &&
				request.Status != BillingRequestStatusSettlementFailed {
				return fmt.Errorf("%w: settle from %s", ErrBillingStateConflict, request.Status)
			}
			nextStatus = BillingRequestStatusSettled
			delta = actualQuota - request.ReservedQuota
		case BillingOperationRefund:
			if request.Status == BillingRequestStatusRefunded {
				result = billingResultFromRequest(&request, true)
				return nil
			}
			if request.Status == BillingRequestStatusSettled ||
				request.Status == BillingRequestStatusSettlementPending ||
				request.Status == BillingRequestStatusSettlementFailed {
				return fmt.Errorf("%w: refund from %s", ErrBillingStateConflict, request.Status)
			}
			if request.Status != BillingRequestStatusReserved &&
				request.Status != BillingRequestStatusRefundPending &&
				request.Status != BillingRequestStatusRefundFailed {
				return fmt.Errorf("%w: refund from %s", ErrBillingStateConflict, request.Status)
			}
			nextStatus = BillingRequestStatusRefunded
			delta = -(request.ReservedQuota - request.RefundedQuota)
		}

		snapshot, err := applyBillingDeltaTx(tx, &request, delta, true)
		if err != nil {
			return err
		}
		ledger := newBillingLedger(
			operationKey,
			&request,
			operation,
			delta,
			request.ReservedQuota,
			actualQuota,
			request.Status,
			nextStatus,
			snapshot,
		)
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}

		updates := map[string]interface{}{}
		if operation == BillingOperationSettle {
			updates["actual_quota"] = actualQuota
		} else {
			updates["refunded_quota"] = request.ReservedQuota
		}
		if err := updateBillingRequestTx(tx, &request, nextStatus, updates); err != nil {
			return err
		}
		if operation == BillingOperationRefund && request.FundingSource == BillingFundingSourceSubscription {
			if err := markSubscriptionBillingRefundedTx(tx, request.RequestId); err != nil {
				return err
			}
		}
		result = billingResultFromLedgerAndRequest(&ledger, &request, false)
		return nil
	})
	if err != nil {
		return nil, err
	}
	invalidateBillingCaches(userID, tokenKey)
	return &result, nil
}

func applyBillingDeltaTx(tx *gorm.DB, request *BillingRequest, delta int64, allowDeleted bool) (billingSnapshot, error) {
	var snapshot billingSnapshot
	if request == nil {
		return snapshot, ErrBillingRequestNotFound
	}
	if delta > math.MaxInt32 || delta < math.MinInt32 {
		return snapshot, errors.New("billing delta exceeds quota storage range")
	}

	switch request.FundingSource {
	case BillingFundingSourceWallet:
		var user User
		userQuery := lockForUpdate(tx)
		if allowDeleted {
			userQuery = userQuery.Unscoped()
		}
		if err := userQuery.Where("id = ?", request.UserId).First(&user).Error; err != nil {
			return snapshot, err
		}
		snapshot.walletBefore = int64(user.Quota)
		snapshot.walletAfter = snapshot.walletBefore - delta
		if snapshot.walletAfter < 0 || snapshot.walletAfter > math.MaxInt32 {
			return snapshot, fmt.Errorf("%w: available=%d need=%d", ErrInsufficientUserQuota, user.Quota, delta)
		}
		userUpdate := tx.Model(&User{})
		if allowDeleted {
			userUpdate = userUpdate.Unscoped()
		}
		update := userUpdate.Where("id = ?", request.UserId).Update("quota", int(snapshot.walletAfter))
		if update.Error != nil {
			return snapshot, update.Error
		}
		if update.RowsAffected != 1 {
			return snapshot, ErrBillingStateConflict
		}
	case BillingFundingSourceSubscription:
		var subscription UserSubscription
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", request.SubscriptionId, request.UserId).First(&subscription).Error; err != nil {
			return snapshot, err
		}
		snapshot.subscriptionUsedBefore = subscription.AmountUsed
		snapshot.subscriptionUsedAfter = subscription.AmountUsed + delta
		if snapshot.subscriptionUsedAfter < 0 ||
			(subscription.AmountTotal > 0 && snapshot.subscriptionUsedAfter > subscription.AmountTotal) {
			return snapshot, fmt.Errorf("subscription quota insufficient, available=%d need=%d",
				subscription.AmountTotal-subscription.AmountUsed, delta)
		}
		update := tx.Model(&UserSubscription{}).
			Where("id = ?", subscription.Id).
			Updates(map[string]interface{}{
				"amount_used": snapshot.subscriptionUsedAfter,
				"updated_at":  common.GetTimestamp(),
			})
		if update.Error != nil {
			return snapshot, update.Error
		}
		if update.RowsAffected != 1 {
			return snapshot, ErrBillingStateConflict
		}
	default:
		return snapshot, errors.New("unsupported billing funding source")
	}

	if request.TokenId <= 0 {
		return snapshot, nil
	}
	var token Token
	tokenQuery := lockForUpdate(tx)
	if allowDeleted {
		tokenQuery = tokenQuery.Unscoped()
	}
	if err := tokenQuery.Where("id = ? AND user_id = ?", request.TokenId, request.UserId).First(&token).Error; err != nil {
		return snapshot, err
	}
	if token.UnlimitedQuota != request.TokenUnlimited {
		return snapshot, ErrBillingRequestConflict
	}
	snapshot.tokenRemainBefore = int64(token.RemainQuota)
	snapshot.tokenUsedBefore = int64(token.UsedQuota)
	snapshot.tokenRemainAfter = snapshot.tokenRemainBefore
	snapshot.tokenUsedAfter = snapshot.tokenUsedBefore + delta
	if snapshot.tokenUsedAfter < 0 || snapshot.tokenUsedAfter > math.MaxInt32 {
		return snapshot, ErrInsufficientTokenQuota
	}
	updates := map[string]interface{}{
		"used_quota":    int(snapshot.tokenUsedAfter),
		"accessed_time": common.GetTimestamp(),
	}
	if !token.UnlimitedQuota {
		snapshot.tokenRemainAfter = snapshot.tokenRemainBefore - delta
		if snapshot.tokenRemainAfter < 0 || snapshot.tokenRemainAfter > math.MaxInt32 {
			return snapshot, fmt.Errorf("%w: available=%d need=%d", ErrInsufficientTokenQuota, token.RemainQuota, delta)
		}
		updates["remain_quota"] = int(snapshot.tokenRemainAfter)
	}
	tokenUpdate := tx.Model(&Token{})
	if allowDeleted {
		tokenUpdate = tokenUpdate.Unscoped()
	}
	update := tokenUpdate.Where("id = ? AND user_id = ?", request.TokenId, request.UserId).Updates(updates)
	if update.Error != nil {
		return snapshot, update.Error
	}
	if update.RowsAffected != 1 {
		return snapshot, ErrBillingStateConflict
	}
	return snapshot, nil
}

func selectSubscriptionForBillingTx(tx *gorm.DB, userID int, requestedID int, targetQuota int64) (*UserSubscription, error) {
	now := getDBTimestampTx(tx)
	if requestedID > 0 {
		var subscription UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ? AND user_id = ? AND status = ? AND end_time > ?", requestedID, userID, "active", now).
			First(&subscription).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, ErrNoActiveSubscription
			}
			return nil, err
		}
		if subscription.AmountTotal > 0 && subscription.AmountTotal-subscription.AmountUsed < targetQuota {
			return nil, fmt.Errorf("%w: need=%d", ErrSubscriptionQuotaInsufficient, targetQuota)
		}
		return &subscription, nil
	}

	var subscriptions []UserSubscription
	if err := lockForUpdate(tx).
		Where("user_id = ? AND status = ? AND end_time > ?", userID, "active", now).
		Order("end_time asc, id asc").
		Find(&subscriptions).Error; err != nil {
		return nil, err
	}
	for i := range subscriptions {
		subscription := &subscriptions[i]
		plan, err := getSubscriptionPlanByIdTx(tx, subscription.PlanId)
		if err != nil {
			return nil, err
		}
		if err := maybeResetUserSubscriptionWithPlanTx(tx, subscription, plan, now); err != nil {
			return nil, err
		}
		if subscription.AmountTotal == 0 || subscription.AmountTotal-subscription.AmountUsed >= targetQuota {
			return subscription, nil
		}
	}
	if len(subscriptions) == 0 {
		return nil, ErrNoActiveSubscription
	}
	return nil, fmt.Errorf("%w: need=%d", ErrSubscriptionQuotaInsufficient, targetQuota)
}

func updateBillingRequestTx(tx *gorm.DB, request *BillingRequest, nextStatus string, fields map[string]interface{}) error {
	if !canTransitionBillingRequest(request.Status, nextStatus) {
		return fmt.Errorf("%w: %s -> %s", ErrBillingInvalidTransition, request.Status, nextStatus)
	}
	now := common.GetTimestamp()
	if now <= request.UpdatedAt {
		now = request.UpdatedAt + 1
	}
	updates := map[string]interface{}{
		"status":     nextStatus,
		"updated_at": now,
		"version":    gorm.Expr("version + 1"),
	}
	for key, value := range fields {
		updates[key] = value
	}
	result := tx.Set("billing:allow_request_update", true).
		Model(&BillingRequest{}).
		Where("id = ? AND version = ?", request.Id, request.Version).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrBillingStateConflict
	}
	return tx.Where("id = ?", request.Id).First(request).Error
}

func newBillingLedger(
	operationKey string,
	request *BillingRequest,
	operation string,
	amount int64,
	targetQuota int64,
	actualQuota int64,
	statusBefore string,
	statusAfter string,
	snapshot billingSnapshot,
) BillingLedger {
	return BillingLedger{
		OperationKey:           operationKey,
		RequestId:              request.RequestId,
		Operation:              operation,
		FundingSource:          request.FundingSource,
		UserId:                 request.UserId,
		TokenId:                request.TokenId,
		SubscriptionId:         request.SubscriptionId,
		Amount:                 amount,
		TargetQuota:            targetQuota,
		ActualQuota:            actualQuota,
		WalletBefore:           snapshot.walletBefore,
		WalletAfter:            snapshot.walletAfter,
		TokenRemainBefore:      snapshot.tokenRemainBefore,
		TokenRemainAfter:       snapshot.tokenRemainAfter,
		TokenUsedBefore:        snapshot.tokenUsedBefore,
		TokenUsedAfter:         snapshot.tokenUsedAfter,
		TokenUnlimited:         request.TokenUnlimited,
		SubscriptionUsedBefore: snapshot.subscriptionUsedBefore,
		SubscriptionUsedAfter:  snapshot.subscriptionUsedAfter,
		RequestStatusBefore:    statusBefore,
		RequestStatusAfter:     statusAfter,
	}
}

func billingLedgerMatchesMutation(
	ledger *BillingLedger,
	request *BillingRequest,
	operation string,
	amount int64,
	targetQuota int64,
	actualQuota int64,
) bool {
	return ledger != nil &&
		request != nil &&
		ledger.RequestId == request.RequestId &&
		ledger.Operation == operation &&
		ledger.FundingSource == request.FundingSource &&
		ledger.UserId == request.UserId &&
		ledger.TokenId == request.TokenId &&
		ledger.SubscriptionId == request.SubscriptionId &&
		ledger.TokenUnlimited == request.TokenUnlimited &&
		ledger.Amount == amount &&
		ledger.TargetQuota == targetQuota &&
		ledger.ActualQuota == actualQuota
}

func billingResultFromRequest(request *BillingRequest, idempotent bool) BillingMutationResult {
	return BillingMutationResult{
		Request:    *request,
		Idempotent: idempotent,
	}
}

func billingResultFromLedgerAndRequest(ledger *BillingLedger, request *BillingRequest, idempotent bool) BillingMutationResult {
	return BillingMutationResult{
		Request:           *request,
		LedgerID:          ledger.Id,
		WalletBefore:      ledger.WalletBefore,
		WalletAfter:       ledger.WalletAfter,
		TokenRemainBefore: ledger.TokenRemainBefore,
		TokenRemainAfter:  ledger.TokenRemainAfter,
		TokenUsedBefore:   ledger.TokenUsedBefore,
		TokenUsedAfter:    ledger.TokenUsedAfter,
		AppliedDelta:      ledger.Amount,
		Idempotent:        idempotent,
	}
}

func upsertSubscriptionBillingCompatibilityTx(tx *gorm.DB, request *BillingRequest) error {
	var record SubscriptionPreConsumeRecord
	query := lockForUpdate(tx).Where("request_id = ?", request.RequestId).Limit(1).Find(&record)
	if query.Error != nil {
		return query.Error
	}
	if query.RowsAffected == 0 {
		return tx.Create(&SubscriptionPreConsumeRecord{
			RequestId:          request.RequestId,
			UserId:             request.UserId,
			UserSubscriptionId: request.SubscriptionId,
			PreConsumed:        request.ReservedQuota,
			Status:             "consumed",
		}).Error
	}
	if record.UserId != request.UserId || record.UserSubscriptionId != request.SubscriptionId || record.Status == "refunded" {
		return ErrBillingRequestConflict
	}
	return tx.Model(&SubscriptionPreConsumeRecord{}).
		Where("id = ?", record.Id).
		Updates(map[string]interface{}{
			"pre_consumed": request.ReservedQuota,
			"updated_at":   common.GetTimestamp(),
		}).Error
}

func markSubscriptionBillingRefundedTx(tx *gorm.DB, requestID string) error {
	result := tx.Model(&SubscriptionPreConsumeRecord{}).
		Where("request_id = ? AND status <> ?", requestID, "refunded").
		Updates(map[string]interface{}{
			"status":     "refunded",
			"updated_at": common.GetTimestamp(),
		})
	return result.Error
}

func invalidateBillingCaches(userID int, tokenKey string) {
	if !common.RedisReady() {
		return
	}
	if err := invalidateUserCache(userID); err != nil {
		common.SysLog(fmt.Sprintf("billing cache invalidation failed: cache=user user_id=%d error=%s", userID, err.Error()))
	}
	if tokenKey != "" {
		if err := cacheDeleteToken(tokenKey); err != nil {
			common.SysLog(fmt.Sprintf("billing cache invalidation failed: cache=token user_id=%d error=%s", userID, err.Error()))
		}
	}
}
