package model

import (
	"bytes"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"github.com/gin-gonic/gin"
)

func setupAPIKeyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	oldDB := DB
	oldLogDB := LOG_DB
	oldSQLite := common.UsingSQLite
	oldMySQL := common.UsingMySQL
	oldPostgres := common.UsingPostgreSQL
	oldRedis := common.RedisEnabled
	oldPepper := common.APIKeyPepper
	oldLegacy := common.APIKeyLegacyAuthEnabled

	common.UsingSQLite = true
	common.UsingMySQL = false
	common.UsingPostgreSQL = false
	common.RedisEnabled = false
	common.APIKeyPepper = "model-api-key-test-pepper-with-sufficient-entropy"
	common.APIKeyLegacyAuthEnabled = true

	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	DB = db
	LOG_DB = db
	require.NoError(t, db.AutoMigrate(&Token{}))

	t.Cleanup(func() {
		_ = sqlDB.Close()
		DB = oldDB
		LOG_DB = oldLogDB
		common.UsingSQLite = oldSQLite
		common.UsingMySQL = oldMySQL
		common.UsingPostgreSQL = oldPostgres
		common.RedisEnabled = oldRedis
		common.APIKeyPepper = oldPepper
		common.APIKeyLegacyAuthEnabled = oldLegacy
	})
	return db
}

func createHashedAPIKeyForTest(t *testing.T, userID int) (*Token, string) {
	t.Helper()
	token := &Token{
		UserId:         userID,
		Name:           "secure-key",
		Status:         common.TokenStatusEnabled,
		CreatedTime:    common.GetTimestamp(),
		AccessedTime:   common.GetTimestamp(),
		ExpiredTime:    -1,
		RemainQuota:    100,
		UnlimitedQuota: true,
		Scopes:         "api,usage",
	}
	raw, err := token.PrepareNewAPIKey()
	require.NoError(t, err)
	require.NoError(t, token.Insert())
	return token, raw
}

func TestNewAPIKeyStoresOnlyHashAndAuthenticates(t *testing.T) {
	db := setupAPIKeyTestDB(t)
	token, raw := createHashedAPIKeyForTest(t, 1)

	var stored Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	require.Equal(t, hashedKeyMarker(stored.PublicId), stored.Key)
	require.NotEqual(t, raw, stored.Key)
	require.NotEmpty(t, stored.KeyHash)
	require.NotEqual(t, raw, stored.KeyHash)
	require.NotContains(t, stored.KeyPrefix, raw)

	authenticated, err := AuthenticateAPIKey(raw)
	require.NoError(t, err)
	require.Equal(t, token.Id, authenticated.Id)

	publicID, _, ok := parseHashedAPIKey(raw)
	require.True(t, ok)
	_, err = AuthenticateAPIKey(apiKeyPrefix + publicID + "_" + strings.Repeat("x", apiKeySecretLength))
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	_, err = AuthenticateAPIKey(apiKeyPrefix + strings.Repeat("z", apiKeyPublicIDLength) + "_" + strings.Repeat("x", apiKeySecretLength))
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

func TestAPIKeyComparisonAndCacheSanitization(t *testing.T) {
	setupAPIKeyTestDB(t)
	hash, err := apiKeyHMAC("high-entropy-secret")
	require.NoError(t, err)
	require.True(t, constantTimeHashEqual(hash, hash))
	otherHash, err := apiKeyHMAC("different-high-entropy-secret")
	require.NoError(t, err)
	require.False(t, constantTimeHashEqual(hash, otherHash))

	token := Token{
		Key:              "plaintext-must-not-be-cached",
		KeyHash:          hash,
		LegacyLookupHash: otherHash,
		PublicId:         "public-id",
	}
	token.Clean()
	require.Empty(t, token.Key)
	require.Empty(t, token.KeyHash)
	require.Empty(t, token.LegacyLookupHash)
	require.Equal(t, "public-id", token.PublicId)
}

func TestAPIKeyAuthenticationLogsDoNotContainCredential(t *testing.T) {
	setupAPIKeyTestDB(t)
	var logs bytes.Buffer
	common.LogWriterMu.Lock()
	oldWriter := gin.DefaultWriter
	oldErrorWriter := gin.DefaultErrorWriter
	gin.DefaultWriter = &logs
	gin.DefaultErrorWriter = &logs
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultWriter = oldWriter
		gin.DefaultErrorWriter = oldErrorWriter
		common.LogWriterMu.Unlock()
	})

	const credential = "credential-that-must-never-appear-in-logs"
	_, _ = ValidateUserToken(credential)
	require.NotContains(t, logs.String(), credential)
	require.NotContains(t, strings.ToLower(logs.String()), "authorization:")
}

func TestAPIKeyDisabledRevokedAndExpiredAreRejected(t *testing.T) {
	db := setupAPIKeyTestDB(t)
	token, raw := createHashedAPIKeyForTest(t, 1)

	require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Update("status", common.TokenStatusDisabled).Error)
	_, err := ValidateUserToken(raw)
	require.ErrorIs(t, err, ErrTokenInvalid)

	require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]interface{}{
		"status":     common.TokenStatusEnabled,
		"revoked_at": common.GetTimestamp(),
	}).Error)
	_, err = ValidateUserToken(raw)
	require.ErrorIs(t, err, ErrTokenInvalid)

	require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]interface{}{
		"revoked_at":   0,
		"expired_time": common.GetTimestamp() - 1,
	}).Error)
	_, err = ValidateUserToken(raw)
	require.ErrorIs(t, err, ErrTokenInvalid)
}

func TestAPIKeyScopeModelAndIPPolicies(t *testing.T) {
	setupAPIKeyTestDB(t)
	ips := "203.0.113.10\n2001:db8::/32"
	token := Token{
		Scopes:             "usage",
		ModelLimitsEnabled: true,
		ModelLimits:        "gpt-5.6,claude-sonnet",
		AllowIps:           &ips,
	}
	require.NoError(t, ValidateAPIKeyPolicyInput(&token))
	require.True(t, token.HasScope("usage"))
	require.False(t, token.HasScope("api"))
	require.True(t, token.GetModelLimitsMap()["gpt-5.6"])
	require.True(t, common.IsIpInCIDRList(common.ParseIP("203.0.113.10"), token.GetIpLimits()))
	require.True(t, common.IsIpInCIDRList(common.ParseIP("2001:db8::1"), token.GetIpLimits()))
	require.False(t, common.IsIpInCIDRList(common.ParseIP("198.51.100.2"), token.GetIpLimits()))

	invalidIPs := "not-an-ip"
	token.AllowIps = &invalidIPs
	require.Error(t, ValidateAPIKeyPolicyInput(&token))

	token.AllowIps = nil
	token.ModelLimits = ""
	require.Error(t, ValidateAPIKeyPolicyInput(&token))
}

func TestRotateAPIKeyRevokesOldKey(t *testing.T) {
	setupAPIKeyTestDB(t)
	token, oldRaw := createHashedAPIKeyForTest(t, 7)
	replacement, newRaw, err := RotateAPIKey(token.Id, 7)
	require.NoError(t, err)
	require.NotEqual(t, oldRaw, newRaw)
	require.NotEqual(t, token.Id, replacement.Id)

	_, err = ValidateUserToken(oldRaw)
	require.ErrorIs(t, err, ErrTokenInvalid)
	authenticated, err := ValidateUserToken(newRaw)
	require.NoError(t, err)
	require.Equal(t, replacement.Id, authenticated.Id)
}

func TestLegacyAPIKeyMigratesOnceUnderConcurrency(t *testing.T) {
	db := setupAPIKeyTestDB(t)
	const legacyRaw = "legacy-api-key-for-concurrent-migration"
	legacy := Token{
		UserId:         9,
		Key:            legacyRaw,
		Name:           "legacy",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		RemainQuota:    100,
		UnlimitedQuota: true,
	}
	require.NoError(t, db.Create(&legacy).Error)

	const workers = 20
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := AuthenticateAPIKey(legacyRaw)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	var migrated Token
	require.NoError(t, db.First(&migrated, legacy.Id).Error)
	require.Equal(t, hashedKeyMarker(migrated.PublicId), migrated.Key)
	require.Equal(t, apiKeyVersionHashed, migrated.KeyVersion)
	require.NotEmpty(t, migrated.PublicId)
	require.NotEmpty(t, migrated.LegacyLookupHash)
	require.NotEmpty(t, migrated.KeyHash)
	require.NoError(t, db.Model(&Token{}).
		Where("id = ? AND key_version = 1", legacy.Id).
		Count(new(int64)).Error)
}

func TestLegacyMigrationFailurePreservesPlaintextKey(t *testing.T) {
	db := setupAPIKeyTestDB(t)
	const legacyRaw = "legacy-api-key-preserved-on-failure"
	legacy := Token{
		UserId:         10,
		Key:            legacyRaw,
		Name:           "legacy-failure",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		RemainQuota:    100,
		UnlimitedQuota: true,
	}
	require.NoError(t, db.Create(&legacy).Error)
	require.NoError(t, db.Exec(`
		CREATE TRIGGER fail_api_key_migration
		BEFORE UPDATE ON tokens
		WHEN NEW.key_version = 1
		BEGIN
			SELECT RAISE(ABORT, 'forced migration failure');
		END
	`).Error)

	_, err := AuthenticateAPIKey(legacyRaw)
	require.Error(t, err)
	var preserved Token
	require.NoError(t, db.First(&preserved, legacy.Id).Error)
	require.Equal(t, legacyRaw, preserved.Key)
	require.Equal(t, 0, preserved.KeyVersion)
	require.Empty(t, preserved.KeyHash)
}

func TestSQLiteAPIKeySecurityMigrationPreservesExistingRows(t *testing.T) {
	oldDB := DB
	oldSQLite := common.UsingSQLite
	common.UsingSQLite = true
	t.Cleanup(func() {
		DB = oldDB
		common.UsingSQLite = oldSQLite
	})

	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	require.NoError(t, db.Exec(`
		CREATE TABLE tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			"key" TEXT NOT NULL,
			status INTEGER NOT NULL DEFAULT 1,
			name TEXT NOT NULL DEFAULT '',
			expired_time INTEGER NOT NULL DEFAULT -1
		);
		INSERT INTO tokens (user_id, "key", name) VALUES (1, 'legacy-existing-key', 'existing');
	`).Error)
	migration, err := os.ReadFile("../migrations/sqlite/20260714_06_api_key_security.sql")
	require.NoError(t, err)
	for _, statement := range strings.Split(string(migration), ";") {
		statement = strings.TrimSpace(statement)
		if statement != "" {
			require.NoError(t, db.Exec(statement).Error)
		}
	}

	var row struct {
		Key        string
		KeyPrefix  string
		LastFour   string
		KeyVersion int
	}
	require.NoError(t, db.Table("tokens").First(&row).Error)
	require.Equal(t, "legacy-existing-key", row.Key)
	require.Equal(t, "legacy-exist", row.KeyPrefix)
	require.Equal(t, "-key", row.LastFour)
	require.Equal(t, 0, row.KeyVersion)

	require.NoError(t, db.Exec(`INSERT INTO tokens (user_id, "key", public_id, key_hash, key_version, name)
		VALUES (2, '', 'public_unique_id', 'hash', 1, 'first')`).Error)
	require.Error(t, db.Exec(`INSERT INTO tokens (user_id, "key", public_id, key_hash, key_version, name)
		VALUES (3, '', 'public_unique_id', 'hash2', 1, 'duplicate')`).Error)
}
