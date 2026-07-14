package model

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func useOptionTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	oldDB := DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Option{}))
	DB = db
	t.Cleanup(func() {
		DB = oldDB
		sqlDB, sqlErr := db.DB()
		if sqlErr == nil && sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func useOptionTestMap(t *testing.T, initial map[string]string) {
	t.Helper()

	common.OptionMapRWMutex.Lock()
	oldMap := common.OptionMap
	common.OptionMap = initial
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldMap
		common.OptionMapRWMutex.Unlock()
	})
}

func TestUpdateOptionPersistsBeforeUpdatingMemory(t *testing.T) {
	db := useOptionTestDB(t)
	useOptionTestMap(t, map[string]string{"test.persistence": "old"})

	require.NoError(t, UpdateOption("test.persistence", "new"))

	var persisted Option
	require.NoError(t, db.First(&persisted, "key = ?", "test.persistence").Error)
	require.Equal(t, "new", persisted.Value)

	common.OptionMapRWMutex.RLock()
	inMemory := common.OptionMap["test.persistence"]
	common.OptionMapRWMutex.RUnlock()
	require.Equal(t, "new", inMemory)
}

func TestUpdateOptionDoesNotMutateMemoryWhenPersistenceFails(t *testing.T) {
	db := useOptionTestDB(t)
	useOptionTestMap(t, map[string]string{"test.persistence": "old"})

	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())

	err = UpdateOption("test.persistence", "new")
	require.ErrorContains(t, err, `persist option "test.persistence"`)

	common.OptionMapRWMutex.RLock()
	inMemory := common.OptionMap["test.persistence"]
	common.OptionMapRWMutex.RUnlock()
	require.Equal(t, "old", inMemory)
}

func TestLoadOptionsFromDatabaseFailsClosed(t *testing.T) {
	db := useOptionTestDB(t)
	useOptionTestMap(t, map[string]string{"test.persistence": "old"})

	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())

	err = loadOptionsFromDatabase()
	require.ErrorContains(t, err, "load options from database")

	common.OptionMapRWMutex.RLock()
	inMemory := common.OptionMap["test.persistence"]
	common.OptionMapRWMutex.RUnlock()
	require.Equal(t, "old", inMemory)
}

func TestUpdateOptionsBulkRollsBackDatabaseAndMemoryTogether(t *testing.T) {
	db := useOptionTestDB(t)
	useOptionTestMap(t, map[string]string{
		"test.bulk.good": "old-good",
		"test.bulk.fail": "old-fail",
	})

	require.NoError(t, db.Create(&Option{Key: "test.bulk.good", Value: "old-good"}).Error)
	require.NoError(t, db.Create(&Option{Key: "test.bulk.fail", Value: "old-fail"}).Error)
	require.NoError(t, db.Exec(`
		CREATE TRIGGER fail_bulk_option_update
		BEFORE UPDATE ON options
		WHEN NEW.key = 'test.bulk.fail'
		BEGIN
			SELECT RAISE(FAIL, 'forced option failure');
		END
	`).Error)

	err := UpdateOptionsBulk(map[string]string{
		"test.bulk.good": "new-good",
		"test.bulk.fail": "new-fail",
	})
	require.ErrorContains(t, err, "forced option failure")

	var good Option
	require.NoError(t, db.First(&good, "key = ?", "test.bulk.good").Error)
	require.Equal(t, "old-good", good.Value)
	var fail Option
	require.NoError(t, db.First(&fail, "key = ?", "test.bulk.fail").Error)
	require.Equal(t, "old-fail", fail.Value)

	common.OptionMapRWMutex.RLock()
	inMemoryGood := common.OptionMap["test.bulk.good"]
	inMemoryFail := common.OptionMap["test.bulk.fail"]
	common.OptionMapRWMutex.RUnlock()
	require.Equal(t, "old-good", inMemoryGood)
	require.Equal(t, "old-fail", inMemoryFail)
}

func TestStripeSecretsCannotBePersistedOrAddedToOptionMap(t *testing.T) {
	db := useOptionTestDB(t)
	useOptionTestMap(t, map[string]string{"safe": "value"})

	for _, key := range []string{"StripeApiSecret", "StripeWebhookSecret"} {
		err := UpdateOption(key, "must-not-persist")
		require.Error(t, err)
		require.True(t, errors.Is(err, ErrStripeSecretOptionForbidden))

		var count int64
		require.NoError(t, db.Model(&Option{}).Where("key = ?", key).Count(&count).Error)
		require.Zero(t, count)
		common.OptionMapRWMutex.RLock()
		_, exists := common.OptionMap[key]
		common.OptionMapRWMutex.RUnlock()
		require.False(t, exists)
	}
}

func TestLegacyStripeSecretsInDatabaseAreIgnored(t *testing.T) {
	db := useOptionTestDB(t)
	useOptionTestMap(t, map[string]string{
		"StripeApiSecret":     "stale-memory-api-secret",
		"StripeWebhookSecret": "stale-memory-webhook-secret",
	})
	originalAPI := setting.StripeApiSecret
	originalWebhook := setting.StripeWebhookSecret
	setting.StripeApiSecret = "environment-api-secret"
	setting.StripeWebhookSecret = "environment-webhook-secret"
	t.Cleanup(func() {
		setting.StripeApiSecret = originalAPI
		setting.StripeWebhookSecret = originalWebhook
	})

	require.NoError(t, db.Create(&Option{Key: "StripeApiSecret", Value: "legacy-db-api-secret"}).Error)
	require.NoError(t, db.Create(&Option{Key: "StripeWebhookSecret", Value: "legacy-db-webhook-secret"}).Error)
	options, err := AllOption()
	require.NoError(t, err)
	require.Empty(t, options)
	require.NoError(t, loadOptionsFromDatabase())

	require.Equal(t, "environment-api-secret", setting.StripeApiSecret)
	require.Equal(t, "environment-webhook-secret", setting.StripeWebhookSecret)
	common.OptionMapRWMutex.RLock()
	_, hasAPISecret := common.OptionMap["StripeApiSecret"]
	_, hasWebhookSecret := common.OptionMap["StripeWebhookSecret"]
	common.OptionMapRWMutex.RUnlock()
	require.False(t, hasAPISecret)
	require.False(t, hasWebhookSecret)
}

func TestUpdateOptionsBulkRejectsStripeSecretsBeforeWriting(t *testing.T) {
	db := useOptionTestDB(t)
	useOptionTestMap(t, map[string]string{"safe": "old"})

	err := UpdateOptionsBulk(map[string]string{
		"safe":            "new",
		"StripeApiSecret": "must-not-persist",
	})
	require.Error(t, err)
	require.True(t, errors.Is(err, ErrStripeSecretOptionForbidden))

	var count int64
	require.NoError(t, db.Model(&Option{}).Count(&count).Error)
	require.Zero(t, count)
	common.OptionMapRWMutex.RLock()
	require.Equal(t, "old", common.OptionMap["safe"])
	_, hasSecret := common.OptionMap["StripeApiSecret"]
	common.OptionMapRWMutex.RUnlock()
	require.False(t, hasSecret)
}
