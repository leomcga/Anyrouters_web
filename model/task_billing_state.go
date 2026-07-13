package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrTaskBillingConflict = errors.New("async task billing identity conflict")
	ErrTaskLeaseConflict   = errors.New("async task lease conflict")
)

func normalizeAsyncRequestID(requestID string) (string, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || len(requestID) > 64 {
		return "", errors.New("invalid async billing request id")
	}
	return requestID, nil
}

func BindAndInsertTask(task *Task, requestID string) error {
	if task == nil {
		return errors.New("task is nil")
	}
	requestID, err := normalizeAsyncRequestID(requestID)
	if err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var request BillingRequest
		if err := lockForUpdate(tx).Where("request_id = ?", requestID).First(&request).Error; err != nil {
			return err
		}
		if request.UserId != task.UserId {
			return ErrTaskBillingConflict
		}
		if err := ensureTaskBillingIdentityAvailable(tx, task.TaskID, requestID, request.Id); err != nil {
			return err
		}
		task.RequestId = &requestID
		task.BillingRequestId = &request.Id
		task.BillingStatus = request.Status
		task.UpstreamTaskID = task.PrivateData.UpstreamTaskID
		task.PriceSnapshotPersisted = task.PrivateData.BillingContext != nil
		task.FinalQuota = int64(task.Quota)
		task.FinalQuotaDetermined = task.PrivateData.BillingContext != nil && task.PrivateData.BillingContext.PerCallBilling
		if task.Version == 0 {
			task.Version = 1
		}
		return tx.Create(task).Error
	})
}

func ensureTaskBillingIdentityAvailable(tx *gorm.DB, taskID string, requestID string, billingRequestID int64) error {
	var count int64
	if err := tx.Model(&Task{}).
		Where("task_id = ? OR request_id = ? OR billing_request_id = ?", taskID, requestID, billingRequestID).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return ErrTaskBillingConflict
	}
	return nil
}

func BindAndInsertMidjourneyTask(task *Midjourney, requestID string) error {
	if task == nil {
		return errors.New("midjourney task is nil")
	}
	requestID, err := normalizeAsyncRequestID(requestID)
	if err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var request BillingRequest
		if err := lockForUpdate(tx).Where("request_id = ?", requestID).First(&request).Error; err != nil {
			return err
		}
		if request.UserId != task.UserId {
			return ErrTaskBillingConflict
		}
		var count int64
		if err := tx.Model(&Midjourney{}).
			Where("mj_id = ? OR request_id = ? OR billing_request_id = ?", task.MjId, requestID, request.Id).
			Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrTaskBillingConflict
		}
		task.RequestId = &requestID
		task.BillingRequestId = &request.Id
		task.BillingStatus = request.Status
		task.PriceSnapshotPersisted = strings.TrimSpace(task.BillingSnapshot) != ""
		task.FinalQuota = int64(task.Quota)
		task.FinalQuotaDetermined = true
		if task.Version == 0 {
			task.Version = 1
		}
		return tx.Create(task).Error
	})
}

func ClaimTask(taskID int64, workerID string, now time.Time, lease time.Duration) (*Task, error) {
	if taskID <= 0 || strings.TrimSpace(workerID) == "" || lease <= 0 {
		return nil, errors.New("invalid task lease parameters")
	}
	var candidate Task
	if err := DB.First(&candidate, taskID).Error; err != nil {
		return nil, err
	}
	nowUnix := now.Unix()
	result := DB.Model(&Task{}).
		Where("id = ? AND version = ? AND (locked_until = 0 OR locked_until <= ?)",
			candidate.ID, candidate.Version, nowUnix).
		Updates(map[string]interface{}{
			"locked_by":    workerID,
			"locked_until": now.Add(lease).Unix(),
			"updated_at":   nowUnix,
			"version":      gorm.Expr("version + 1"),
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrTaskLeaseConflict
	}
	if err := DB.First(&candidate, taskID).Error; err != nil {
		return nil, err
	}
	return &candidate, nil
}

func UpdateClaimedTask(task *Task, workerID string, updates map[string]interface{}, release bool) error {
	if task == nil || task.ID <= 0 || strings.TrimSpace(workerID) == "" {
		return errors.New("invalid claimed task update")
	}
	now := common.GetTimestamp()
	updates["updated_at"] = now
	updates["version"] = gorm.Expr("version + 1")
	if release {
		updates["locked_by"] = ""
		updates["locked_until"] = int64(0)
	}
	result := DB.Model(&Task{}).
		Where("id = ? AND version = ? AND locked_by = ?", task.ID, task.Version, workerID).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskLeaseConflict
	}
	return nil
}

func ClaimMidjourneyTask(taskID int, workerID string, now time.Time, lease time.Duration) (*Midjourney, error) {
	if taskID <= 0 || strings.TrimSpace(workerID) == "" || lease <= 0 {
		return nil, errors.New("invalid midjourney task lease parameters")
	}
	var candidate Midjourney
	if err := DB.First(&candidate, taskID).Error; err != nil {
		return nil, err
	}
	nowUnix := now.Unix()
	result := DB.Model(&Midjourney{}).
		Where("id = ? AND version = ? AND (locked_until = 0 OR locked_until <= ?)",
			candidate.Id, candidate.Version, nowUnix).
		Updates(map[string]interface{}{
			"locked_by":    workerID,
			"locked_until": now.Add(lease).Unix(),
			"version":      gorm.Expr("version + 1"),
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrTaskLeaseConflict
	}
	if err := DB.First(&candidate, taskID).Error; err != nil {
		return nil, err
	}
	return &candidate, nil
}

func UpdateClaimedMidjourneyTask(task *Midjourney, workerID string, updates map[string]interface{}, release bool) error {
	if task == nil || task.Id <= 0 || strings.TrimSpace(workerID) == "" {
		return errors.New("invalid claimed midjourney task update")
	}
	updates["version"] = gorm.Expr("version + 1")
	if release {
		updates["locked_by"] = ""
		updates["locked_until"] = int64(0)
	}
	result := DB.Model(&Midjourney{}).
		Where("id = ? AND version = ? AND locked_by = ?", task.Id, task.Version, workerID).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskLeaseConflict
	}
	return nil
}

func BillingRequestStatus(requestID string) (string, error) {
	requestID, err := normalizeAsyncRequestID(requestID)
	if err != nil {
		return "", err
	}
	var request BillingRequest
	if err := DB.Select("status").Where("request_id = ?", requestID).First(&request).Error; err != nil {
		return "", err
	}
	return request.Status, nil
}

func GetTaskBillingCandidates(limit int) []*Task {
	if limit <= 0 {
		return nil
	}
	var tasks []*Task
	err := DB.Where(
		"progress != ? OR billing_status IN ? OR (billing_status = ? AND upstream_result_persisted = ? AND usage_accounted = ?)",
		"100%",
		[]string{
			BillingRequestStatusSettlementPending,
			BillingRequestStatusSettlementFailed,
			BillingRequestStatusRefundPending,
			BillingRequestStatusRefundFailed,
		},
		BillingRequestStatusSettled,
		true,
		false,
	).Order("id").Limit(limit).Find(&tasks).Error
	if err != nil {
		return nil
	}
	return tasks
}

func SyncTaskFromBillingRequest(taskID int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var task Task
		if err := lockForUpdate(tx).First(&task, taskID).Error; err != nil {
			return err
		}
		if task.RequestId == nil || strings.TrimSpace(*task.RequestId) == "" {
			return ErrBillingRequestNotFound
		}
		var request BillingRequest
		if err := lockForUpdate(tx).Where("request_id = ?", *task.RequestId).First(&request).Error; err != nil {
			return err
		}
		updates := map[string]interface{}{
			"billing_status":     request.Status,
			"billing_last_error": "",
			"updated_at":         common.GetTimestamp(),
			"version":            gorm.Expr("version + 1"),
		}
		switch request.Status {
		case BillingRequestStatusSettled:
			updates["status"] = TaskStatusSuccess
			updates["progress"] = "100%"
			updates["quota"] = request.ActualQuota
			updates["final_quota"] = request.ActualQuota
			updates["final_quota_determined"] = true
		case BillingRequestStatusRefunded:
			updates["status"] = TaskStatusFailure
			updates["progress"] = "100%"
		case BillingRequestStatusManualReview:
			updates["progress"] = "99%"
		}
		return tx.Model(&Task{}).Where("id = ?", task.ID).Updates(updates).Error
	})
}

func SyncMidjourneyFromBillingRequest(taskID int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var task Midjourney
		if err := lockForUpdate(tx).First(&task, taskID).Error; err != nil {
			return err
		}
		if task.RequestId == nil || strings.TrimSpace(*task.RequestId) == "" {
			return ErrBillingRequestNotFound
		}
		var request BillingRequest
		if err := lockForUpdate(tx).Where("request_id = ?", *task.RequestId).First(&request).Error; err != nil {
			return err
		}
		updates := map[string]interface{}{
			"billing_status":     request.Status,
			"billing_last_error": "",
			"version":            gorm.Expr("version + 1"),
		}
		switch request.Status {
		case BillingRequestStatusSettled:
			updates["status"] = "SUCCESS"
			updates["progress"] = "100%"
		case BillingRequestStatusRefunded:
			updates["status"] = "FAILURE"
			updates["progress"] = "100%"
		case BillingRequestStatusManualReview:
			updates["progress"] = "99%"
		}
		return tx.Model(&Midjourney{}).Where("id = ?", task.Id).Updates(updates).Error
	})
}

func AccountTaskUsage(taskID int64, quota int64) (bool, error) {
	accounted := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var task Task
		if err := lockForUpdate(tx).First(&task, taskID).Error; err != nil {
			return err
		}
		if task.UsageAccounted {
			return nil
		}
		if err := tx.Model(&User{}).Where("id = ?", task.UserId).Updates(map[string]interface{}{
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"request_count": gorm.Expr("request_count + 1"),
		}).Error; err != nil {
			return err
		}
		if task.ChannelId > 0 {
			if err := tx.Model(&Channel{}).Where("id = ?", task.ChannelId).
				Update("used_quota", gorm.Expr("used_quota + ?", quota)).Error; err != nil {
				return err
			}
		}
		result := tx.Model(&Task{}).Where("id = ? AND usage_accounted = ?", task.ID, false).
			Update("usage_accounted", true)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTaskBillingConflict
		}
		accounted = true
		return nil
	})
	return accounted, err
}

func AccountMidjourneyUsage(taskID int, quota int64) (bool, error) {
	accounted := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var task Midjourney
		if err := lockForUpdate(tx).First(&task, taskID).Error; err != nil {
			return err
		}
		if task.UsageAccounted {
			return nil
		}
		if err := tx.Model(&User{}).Where("id = ?", task.UserId).Updates(map[string]interface{}{
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"request_count": gorm.Expr("request_count + 1"),
		}).Error; err != nil {
			return err
		}
		if task.ChannelId > 0 {
			if err := tx.Model(&Channel{}).Where("id = ?", task.ChannelId).
				Update("used_quota", gorm.Expr("used_quota + ?", quota)).Error; err != nil {
				return err
			}
		}
		result := tx.Model(&Midjourney{}).Where("id = ? AND usage_accounted = ?", task.Id, false).
			Update("usage_accounted", true)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTaskBillingConflict
		}
		accounted = true
		return nil
	})
	return accounted, err
}
