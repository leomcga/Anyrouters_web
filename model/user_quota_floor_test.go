package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupUserQuotaFloorTestDB(t *testing.T) {
	t.Helper()

	oldDB := DB
	oldBatchUpdateEnabled := common.BatchUpdateEnabled
	oldRedisEnabled := common.RedisEnabled
	oldUsingSQLite := common.UsingSQLite

	db, err := gorm.Open(sqlite.Open("file:user-quota-floor?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec("DROP TABLE IF EXISTS users").Error)
	require.NoError(t, db.Exec("CREATE TABLE users (id INTEGER PRIMARY KEY, quota INTEGER NOT NULL, deleted_at DATETIME)").Error)

	DB = db
	common.BatchUpdateEnabled = false
	common.RedisEnabled = false
	common.UsingSQLite = true

	t.Cleanup(func() {
		DB = oldDB
		common.BatchUpdateEnabled = oldBatchUpdateEnabled
		common.RedisEnabled = oldRedisEnabled
		common.UsingSQLite = oldUsingSQLite
	})
}

func TestDecreaseUserQuotaWithFloorReproducesProductionShortfall(t *testing.T) {
	setupUserQuotaFloorTestDB(t)

	// Production incident: $0.278252 remained before the request. The normal
	// pre-consume charged $0.039840, leaving 119,206 quota. The final delta was
	// 173,260 quota, so only 119,206 may be collected and 54,054 must be
	// recorded as shortfall instead of making the wallet negative.
	require.NoError(t, DB.Exec("INSERT INTO users (id, quota) VALUES (?, ?)", 16, 139126).Error)
	require.NoError(t, DecreaseUserQuota(16, 19920, true))

	deducted, shortfall, err := DecreaseUserQuotaWithFloor(16, 173260)
	require.NoError(t, err)
	require.Equal(t, 119206, deducted)
	require.Equal(t, 54054, shortfall)

	var quota int
	require.NoError(t, DB.Table("users").Select("quota").Where("id = ?", 16).Scan(&quota).Error)
	require.Zero(t, quota)
}

func TestDecreaseUserQuotaWithFloorChargesNormallyWhenCovered(t *testing.T) {
	setupUserQuotaFloorTestDB(t)
	require.NoError(t, DB.Exec("INSERT INTO users (id, quota) VALUES (?, ?)", 7, 100).Error)

	deducted, shortfall, err := DecreaseUserQuotaWithFloor(7, 40)
	require.NoError(t, err)
	require.Equal(t, 40, deducted)
	require.Zero(t, shortfall)

	var quota int
	require.NoError(t, DB.Table("users").Select("quota").Where("id = ?", 7).Scan(&quota).Error)
	require.Equal(t, 60, quota)
}

func TestDecreaseUserQuotaWithFloorRejectsBatchModeWithoutChangingBalance(t *testing.T) {
	setupUserQuotaFloorTestDB(t)
	require.NoError(t, DB.Exec("INSERT INTO users (id, quota) VALUES (?, ?)", 8, 100).Error)
	common.BatchUpdateEnabled = true

	deducted, shortfall, err := DecreaseUserQuotaWithFloor(8, 40)
	require.ErrorContains(t, err, "不支持批量更新模式")
	require.Zero(t, deducted)
	require.Equal(t, 40, shortfall)

	var quota int
	require.NoError(t, DB.Table("users").Select("quota").Where("id = ?", 8).Scan(&quota).Error)
	require.Equal(t, 100, quota)
}
