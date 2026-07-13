package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const sandboxBillingModelName = "sandbox-exec"

var ErrSandboxQuotaInsufficient = errors.New("sandbox free quota exhausted and insufficient balance")

type SandboxBillingReservation struct {
	RequestID string
	UserID    int
	IsFree    bool
	Quota     int64
	Ordinal   int
}

func sandboxBillingEnabled() bool {
	return common.GetEnvOrDefaultBool("SANDBOX_BILLING_ENABLED", true)
}

func sandboxFreeDaily() int {
	return common.GetEnvOrDefault("SANDBOX_FREE_DAILY", 50)
}

func sandboxExecQuota() int {
	return common.GetEnvOrDefault("SANDBOX_EXEC_QUOTA", 100)
}

func sandboxRequestID(c *gin.Context) string {
	base := ""
	if c != nil {
		base = common.GetContextKeyString(c, common.RequestIdKey)
	}
	if base == "" {
		base = common.GetTimeString() + common.GetRandomString(16)
	}
	sum := sha256.Sum256([]byte(base))
	return fmt.Sprintf("sandbox-%x", sum[:28])
}

func PrepareSandboxExecution(c *gin.Context, userID int) (*SandboxBillingReservation, error) {
	if !sandboxBillingEnabled() {
		return &SandboxBillingReservation{UserID: userID, IsFree: true}, nil
	}
	requestID := sandboxRequestID(c)
	quota := int64(sandboxExecQuota())
	if quota < 0 {
		return nil, errors.New("sandbox execution quota must not be negative")
	}
	execution, err := model.ReserveSandboxExecution(requestID, userID, sandboxFreeDaily(), quota)
	if err != nil {
		return nil, err
	}
	reservation := &SandboxBillingReservation{
		RequestID: execution.RequestId,
		UserID:    execution.UserId,
		IsFree:    execution.IsFree,
		Quota:     execution.Quota,
		Ordinal:   execution.Ordinal,
	}
	if execution.IsFree || execution.Status == model.SandboxExecutionStatusSucceeded {
		return reservation, nil
	}
	_, err = model.ReserveBillingRequest(model.BillingReserveParams{
		RequestID:     execution.RequestId,
		FundingSource: model.BillingFundingSourceWallet,
		UserID:        execution.UserId,
		TargetQuota:   execution.Quota,
		SkipToken:     true,
	})
	if err != nil {
		_ = model.CancelSandboxExecution(execution.RequestId)
		if errors.Is(err, model.ErrInsufficientUserQuota) {
			return nil, ErrSandboxQuotaInsufficient
		}
		return nil, err
	}
	return reservation, nil
}

func CompleteSandboxExecution(ctx context.Context, reservation *SandboxBillingReservation) error {
	if reservation == nil || reservation.RequestID == "" {
		return nil
	}
	var billingErr error
	if !reservation.IsFree {
		if _, err := model.SettleBillingRequest(reservation.RequestID, reservation.Quota); err != nil {
			billingErr = err
			if _, queueErr := model.QueueBillingJob(
				reservation.RequestID,
				model.BillingJobOperationSettle,
				reservation.Quota,
				err.Error(),
			); queueErr != nil {
				return fmt.Errorf("sandbox settlement failed: %w; queue failed: %v", err, queueErr)
			}
		}
	}
	if err := model.CompleteSandboxExecution(reservation.RequestID); err != nil {
		return err
	}
	if billingErr != nil {
		common.SysError(fmt.Sprintf("sandbox settlement queued request_id=%s error=%s",
			reservation.RequestID, model.SanitizeBillingError(billingErr.Error())))
	}
	return nil
}

func FailSandboxExecution(ctx context.Context, reservation *SandboxBillingReservation) error {
	if reservation == nil || reservation.RequestID == "" {
		return nil
	}
	if !reservation.IsFree {
		if _, err := model.RefundBillingRequest(reservation.RequestID); err != nil {
			if _, queueErr := model.QueueBillingJob(
				reservation.RequestID,
				model.BillingJobOperationRefund,
				0,
				err.Error(),
			); queueErr != nil {
				return fmt.Errorf("sandbox refund failed: %w; queue failed: %v", err, queueErr)
			}
		}
	}
	return model.CancelSandboxExecution(reservation.RequestID)
}

func RecoverStaleSandboxExecutions(ctx context.Context, cutoff int64, limit int) (int, error) {
	executions, err := model.GetStaleSandboxExecutions(cutoff, limit)
	if err != nil {
		return 0, err
	}
	recovered := 0
	for i := range executions {
		execution := &executions[i]
		reservation := &SandboxBillingReservation{
			RequestID: execution.RequestId,
			UserID:    execution.UserId,
			IsFree:    execution.IsFree,
			Quota:     execution.Quota,
			Ordinal:   execution.Ordinal,
		}
		if err := FailSandboxExecution(ctx, reservation); err != nil {
			return recovered, err
		}
		recovered++
	}
	return recovered, nil
}
