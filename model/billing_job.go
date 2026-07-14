package model

import (
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	billingCredentialPattern = regexp.MustCompile(`(?i)\b(authorization|api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+`)
	billingSecretKeyPattern  = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{8,}\b`)
	billingURLAuthPattern    = regexp.MustCompile(`://[^/@\s]+@`)
)

const (
	BillingJobOperationSettle = "settle"
	BillingJobOperationRefund = "refund"

	BillingJobStatusPending      = "pending"
	BillingJobStatusProcessing   = "processing"
	BillingJobStatusRetry        = "retry"
	BillingJobStatusCompleted    = "completed"
	BillingJobStatusFailed       = "failed"
	BillingJobStatusManualReview = "manual_review"
)

type BillingJob struct {
	Id            int64  `json:"id" gorm:"primaryKey"`
	RequestId     string `json:"request_id" gorm:"type:varchar(64);not null;index:idx_billing_jobs_request_id"`
	OperationKey  string `json:"operation_key" gorm:"type:varchar(128);not null;uniqueIndex:idx_billing_jobs_operation_key"`
	OperationType string `json:"operation_type" gorm:"type:varchar(32);not null;index:idx_billing_jobs_operation_type"`
	Status        string `json:"status" gorm:"type:varchar(32);not null;index:idx_billing_jobs_scan,priority:1"`
	TargetQuota   int64  `json:"target_quota" gorm:"type:bigint;not null;default:0"`
	Attempts      int    `json:"attempts" gorm:"not null;default:0"`
	MaxAttempts   int    `json:"max_attempts" gorm:"not null;default:10"`
	NextRetryAt   int64  `json:"next_retry_at" gorm:"type:bigint;not null;default:0;index:idx_billing_jobs_scan,priority:2"`
	LockedBy      string `json:"locked_by" gorm:"type:varchar(128);not null;default:''"`
	LockedUntil   int64  `json:"locked_until" gorm:"type:bigint;not null;default:0;index:idx_billing_jobs_locked_until"`
	LastError     string `json:"last_error" gorm:"type:text;not null"`
	Version       int64  `json:"version" gorm:"type:bigint;not null;default:1"`
	CreatedAt     int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt     int64  `json:"updated_at" gorm:"type:bigint;not null"`
	CompletedAt   int64  `json:"completed_at" gorm:"type:bigint;not null;default:0"`
}

func (j *BillingJob) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	if j.Status == "" {
		j.Status = BillingJobStatusPending
	}
	if j.MaxAttempts <= 0 {
		j.MaxAttempts = 10
	}
	if j.Version == 0 {
		j.Version = 1
	}
	if j.CreatedAt == 0 {
		j.CreatedAt = now
	}
	if j.UpdatedAt == 0 {
		j.UpdatedAt = now
	}
	return nil
}

func QueueBillingJob(requestID string, operationType string, targetQuota int64, lastError string) (*BillingJob, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil, errors.New("billing job request id is empty")
	}
	if operationType != BillingJobOperationSettle && operationType != BillingJobOperationRefund {
		return nil, errors.New("invalid billing job operation")
	}
	operationKey := billingTerminalOperationKey(requestID, "job:"+operationType)
	now := common.GetTimestamp()
	job := &BillingJob{
		RequestId:     requestID,
		OperationKey:  operationKey,
		OperationType: operationType,
		Status:        BillingJobStatusPending,
		TargetQuota:   targetQuota,
		NextRetryAt:   now,
		LastError:     sanitizeBillingJobError(lastError),
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var request BillingRequest
		if err := lockForUpdate(tx).Where("request_id = ?", requestID).First(&request).Error; err != nil {
			return err
		}
		pendingStatus := BillingRequestStatusSettlementPending
		if operationType == BillingJobOperationRefund {
			pendingStatus = BillingRequestStatusRefundPending
		}
		if operationType == BillingJobOperationSettle && request.Status == BillingRequestStatusSettled {
			job.Status = BillingJobStatusCompleted
			job.CompletedAt = now
		} else if operationType == BillingJobOperationRefund && request.Status == BillingRequestStatusRefunded {
			job.Status = BillingJobStatusCompleted
			job.CompletedAt = now
		} else {
			if err := updateBillingRequestTx(tx, &request, pendingStatus, nil); err != nil {
				return err
			}
		}

		var existing BillingJob
		query := lockForUpdate(tx).Where("operation_key = ?", operationKey).Limit(1).Find(&existing)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected == 0 {
			return tx.Create(job).Error
		}
		if existing.OperationType != operationType ||
			existing.RequestId != requestID ||
			(operationType == BillingJobOperationSettle && existing.TargetQuota != targetQuota) {
			return ErrBillingOperationConflict
		}
		if existing.Status == BillingJobStatusCompleted {
			*job = existing
			return nil
		}
		if existing.Status == BillingJobStatusManualReview {
			return ErrBillingStateConflict
		}
		if existing.Status == BillingJobStatusProcessing && existing.LockedUntil > now {
			*job = existing
			return nil
		}
		updates := map[string]interface{}{
			"status":        BillingJobStatusRetry,
			"next_retry_at": now,
			"last_error":    sanitizeBillingJobError(lastError),
			"locked_by":     "",
			"locked_until":  int64(0),
			"updated_at":    now,
			"version":       gorm.Expr("version + 1"),
		}
		if job.Status == BillingJobStatusCompleted {
			updates["status"] = BillingJobStatusCompleted
			updates["completed_at"] = now
			updates["last_error"] = ""
		}
		if err := tx.Model(&BillingJob{}).Where("id = ?", existing.Id).Updates(updates).Error; err != nil {
			return err
		}
		return tx.First(job, existing.Id).Error
	})
	return job, err
}

func ClaimBillingJob(workerID string, now time.Time, lease time.Duration) (*BillingJob, error) {
	workerID = strings.TrimSpace(workerID)
	if workerID == "" {
		return nil, errors.New("billing worker id is empty")
	}
	if len(workerID) > 128 {
		return nil, errors.New("billing worker id is too long")
	}
	if lease <= 0 {
		return nil, errors.New("billing job lease must be positive")
	}
	nowUnix := now.Unix()
	lockedUntil := now.Add(lease).Unix()
	for attempt := 0; attempt < 8; attempt++ {
		var candidate BillingJob
		query := DB.
			Where("status IN ? AND next_retry_at <= ? AND (locked_until = 0 OR locked_until <= ?)",
				[]string{BillingJobStatusPending, BillingJobStatusRetry, BillingJobStatusProcessing}, nowUnix, nowUnix).
			Order("next_retry_at asc, id asc").
			Limit(1).
			Find(&candidate)
		if query.Error != nil {
			return nil, query.Error
		}
		if query.RowsAffected == 0 {
			return nil, nil
		}
		update := DB.Model(&BillingJob{}).
			Where("id = ? AND version = ? AND status IN ? AND next_retry_at <= ? AND (locked_until = 0 OR locked_until <= ?)",
				candidate.Id, candidate.Version,
				[]string{BillingJobStatusPending, BillingJobStatusRetry, BillingJobStatusProcessing},
				nowUnix, nowUnix).
			Updates(map[string]interface{}{
				"status":       BillingJobStatusProcessing,
				"attempts":     gorm.Expr("attempts + 1"),
				"locked_by":    workerID,
				"locked_until": lockedUntil,
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

func CompleteBillingJob(jobID int64, workerID string, now time.Time) error {
	result := DB.Model(&BillingJob{}).
		Where("id = ? AND status = ? AND locked_by = ?", jobID, BillingJobStatusProcessing, workerID).
		Updates(map[string]interface{}{
			"status":       BillingJobStatusCompleted,
			"locked_by":    "",
			"locked_until": int64(0),
			"completed_at": now.Unix(),
			"updated_at":   now.Unix(),
			"last_error":   "",
			"version":      gorm.Expr("version + 1"),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrBillingStateConflict
	}
	return nil
}

func FailBillingJob(job *BillingJob, workerID string, runErr error, now time.Time) error {
	if job == nil {
		return errors.New("billing job is nil")
	}
	status := BillingJobStatusRetry
	nextRetryAt := now.Add(billingJobBackoff(job.Attempts)).Unix()
	if job.Attempts >= job.MaxAttempts {
		status = BillingJobStatusManualReview
		nextRetryAt = 0
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var lockedJob BillingJob
		if err := lockForUpdate(tx).
			Where("id = ? AND status = ? AND locked_by = ?", job.Id, BillingJobStatusProcessing, workerID).
			First(&lockedJob).Error; err != nil {
			return err
		}
		result := tx.Model(&BillingJob{}).
			Where("id = ? AND version = ?", lockedJob.Id, lockedJob.Version).
			Updates(map[string]interface{}{
				"status":        status,
				"next_retry_at": nextRetryAt,
				"locked_by":     "",
				"locked_until":  int64(0),
				"last_error":    sanitizeBillingJobError(runErr.Error()),
				"updated_at":    now.Unix(),
				"version":       gorm.Expr("version + 1"),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrBillingStateConflict
		}

		var request BillingRequest
		if err := lockForUpdate(tx).Where("request_id = ?", lockedJob.RequestId).First(&request).Error; err != nil {
			return err
		}
		failureStatus := BillingRequestStatusSettlementFailed
		if lockedJob.OperationType == BillingJobOperationRefund {
			failureStatus = BillingRequestStatusRefundFailed
		}
		if status == BillingJobStatusManualReview {
			failureStatus = BillingRequestStatusManualReview
		}
		if request.Status == BillingRequestStatusSettled || request.Status == BillingRequestStatusRefunded {
			return nil
		}
		return updateBillingRequestTx(tx, &request, failureStatus, nil)
	})
}

func billingJobBackoff(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	if attempts > 8 {
		attempts = 8
	}
	return time.Duration(1<<uint(attempts-1)) * time.Minute
}

func sanitizeBillingJobError(message string) string {
	message = strings.TrimSpace(message)
	message = billingCredentialPattern.ReplaceAllString(message, "$1=[REDACTED]")
	message = billingSecretKeyPattern.ReplaceAllString(message, "[REDACTED_KEY]")
	message = billingURLAuthPattern.ReplaceAllString(message, "://[REDACTED]@")
	if len(message) > 1000 {
		message = message[:1000]
	}
	return message
}

func SanitizeBillingError(message string) string {
	return sanitizeBillingJobError(message)
}
