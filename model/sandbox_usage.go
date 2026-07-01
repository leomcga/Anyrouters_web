package model

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SandboxDailyUsage tracks how many times a user has executed code in the
// playground sandbox (E2B) on a given UTC day. It backs the "N free executions
// per day, then bill at cost" policy for /pg/execute.
//
// Why DB (not memory/Redis): the newapi Cloud Run service runs multiple
// instances (maxScale=3) and has no Redis, so an in-memory counter would be
// split across instances. The DB (MySQL/CloudSQL) is the only shared,
// instance-safe store available.
type SandboxDailyUsage struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	UserId    int    `json:"user_id" gorm:"uniqueIndex:idx_sandbox_user_day,priority:1"`
	Day       string `json:"day" gorm:"size:8;uniqueIndex:idx_sandbox_user_day,priority:2"` // UTC yyyymmdd
	Count     int    `json:"count" gorm:"default:0"`
	UpdatedAt int64  `json:"updated_at"`
}

func (SandboxDailyUsage) TableName() string {
	return "sandbox_daily_usage"
}

// sandboxDay returns the current UTC day key (yyyymmdd). Using UTC keeps the
// reset boundary consistent across instances regardless of server timezone.
func sandboxDay() string {
	return time.Now().UTC().Format("20060102")
}

// IncrAndGetSandboxDailyCount atomically increments today's execution count for
// the user and returns the new count (i.e. including this execution). Cross-DB
// safe via GORM's OnConflict upsert (SQLite/MySQL/PostgreSQL).
//
// Call this ONLY after a successful execution — failed runs must not consume
// the free quota or trigger billing.
func IncrAndGetSandboxDailyCount(userId int) (int, error) {
	day := sandboxDay()
	row := &SandboxDailyUsage{
		UserId:    userId,
		Day:       day,
		Count:     1,
		UpdatedAt: time.Now().Unix(),
	}
	err := DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "user_id"},
			{Name: "day"},
		},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"count":      gorm.Expr("sandbox_daily_usage.count + 1"),
			"updated_at": time.Now().Unix(),
		}),
	}).Create(row).Error
	if err != nil {
		return 0, err
	}

	// Re-read to get the authoritative post-increment count (the upsert doesn't
	// reliably populate row.Count on the update path across all drivers).
	var count int
	err = DB.Model(&SandboxDailyUsage{}).
		Where("user_id = ? AND day = ?", userId, day).
		Select("count").
		Find(&count).Error
	if err != nil {
		return 0, err
	}
	return count, nil
}

// GetSandboxDailyCount returns how many executions the user has already done
// today (without incrementing). Used to decide up-front whether the next
// execution will fall in the free tier or require quota.
func GetSandboxDailyCount(userId int) (int, error) {
	var count int
	err := DB.Model(&SandboxDailyUsage{}).
		Where("user_id = ? AND day = ?", userId, sandboxDay()).
		Select("count").
		Find(&count).Error
	if err != nil {
		return 0, err
	}
	return count, nil
}
