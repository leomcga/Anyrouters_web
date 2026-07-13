package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	SandboxExecutionStatusReserved  = "reserved"
	SandboxExecutionStatusSucceeded = "succeeded"
	SandboxExecutionStatusFailed    = "failed"
)

type SandboxExecution struct {
	Id        int64  `json:"id" gorm:"primaryKey"`
	RequestId string `json:"request_id" gorm:"type:varchar(64);not null;uniqueIndex:idx_sandbox_executions_request_id"`
	UserId    int    `json:"user_id" gorm:"not null;index:idx_sandbox_executions_user_day,priority:1"`
	Day       string `json:"day" gorm:"size:8;not null;index:idx_sandbox_executions_user_day,priority:2"`
	Ordinal   int    `json:"ordinal" gorm:"not null"`
	IsFree    bool   `json:"is_free" gorm:"not null"`
	Quota     int64  `json:"quota" gorm:"type:bigint;not null;default:0"`
	Status    string `json:"status" gorm:"type:varchar(24);not null;index:idx_sandbox_executions_status_created,priority:1"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;not null;index:idx_sandbox_executions_status_created,priority:2"`
	UpdatedAt int64  `json:"updated_at" gorm:"type:bigint;not null"`
}

func ReserveSandboxExecution(requestID string, userID int, freeLimit int, paidQuota int64) (*SandboxExecution, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || len(requestID) > 64 || userID <= 0 || freeLimit < 0 || paidQuota < 0 {
		return nil, errors.New("invalid sandbox execution reservation")
	}
	var execution SandboxExecution
	err := DB.Transaction(func(tx *gorm.DB) error {
		query := lockForUpdate(tx).Where("request_id = ?", requestID).Limit(1).Find(&execution)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected == 1 {
			if execution.UserId != userID {
				return ErrBillingOperationConflict
			}
			return nil
		}

		day := time.Now().UTC().Format("20060102")
		seed := SandboxDailyUsage{UserId: userID, Day: day, Count: 0, UpdatedAt: common.GetTimestamp()}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&seed).Error; err != nil {
			return err
		}
		var usage SandboxDailyUsage
		if err := lockForUpdate(tx).Where("user_id = ? AND day = ?", userID, day).First(&usage).Error; err != nil {
			return err
		}
		ordinal := usage.Count + 1
		if err := tx.Model(&SandboxDailyUsage{}).Where("id = ? AND count = ?", usage.Id, usage.Count).
			Updates(map[string]interface{}{
				"count":      ordinal,
				"updated_at": common.GetTimestamp(),
			}).Error; err != nil {
			return err
		}
		execution = SandboxExecution{
			RequestId: requestID,
			UserId:    userID,
			Day:       day,
			Ordinal:   ordinal,
			IsFree:    ordinal <= freeLimit,
			Status:    SandboxExecutionStatusReserved,
			CreatedAt: common.GetTimestamp(),
			UpdatedAt: common.GetTimestamp(),
		}
		if !execution.IsFree {
			execution.Quota = paidQuota
		}
		return tx.Create(&execution).Error
	})
	return &execution, err
}

func CompleteSandboxExecution(requestID string) error {
	result := DB.Model(&SandboxExecution{}).
		Where("request_id = ? AND status = ?", requestID, SandboxExecutionStatusReserved).
		Updates(map[string]interface{}{
			"status":     SandboxExecutionStatusSucceeded,
			"updated_at": common.GetTimestamp(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var execution SandboxExecution
		if err := DB.Where("request_id = ?", requestID).First(&execution).Error; err != nil {
			return err
		}
		if execution.Status != SandboxExecutionStatusSucceeded {
			return ErrBillingStateConflict
		}
	}
	return nil
}

func CancelSandboxExecution(requestID string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var execution SandboxExecution
		if err := lockForUpdate(tx).Where("request_id = ?", requestID).First(&execution).Error; err != nil {
			return err
		}
		if execution.Status == SandboxExecutionStatusFailed {
			return nil
		}
		if execution.Status != SandboxExecutionStatusReserved {
			return ErrBillingStateConflict
		}
		result := tx.Model(&SandboxDailyUsage{}).
			Where("user_id = ? AND day = ? AND count > 0", execution.UserId, execution.Day).
			Updates(map[string]interface{}{
				"count":      gorm.Expr("count - 1"),
				"updated_at": common.GetTimestamp(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrBillingStateConflict
		}
		return tx.Model(&SandboxExecution{}).Where("id = ?", execution.Id).Updates(map[string]interface{}{
			"status":     SandboxExecutionStatusFailed,
			"updated_at": common.GetTimestamp(),
		}).Error
	})
}

func GetStaleSandboxExecutions(cutoff int64, limit int) ([]SandboxExecution, error) {
	var executions []SandboxExecution
	err := DB.Where("status = ? AND created_at <= ?", SandboxExecutionStatusReserved, cutoff).
		Order("id").Limit(limit).Find(&executions).Error
	return executions, err
}
