package model

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	embeddedmigrations "github.com/QuantumNous/new-api/migrations"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newSchemaMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "migration.db")
	db, err := gorm.Open(sqlite.Open(path+"?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(8)
	t.Cleanup(func() {
		require.NoError(t, sqlDB.Close())
	})
	return db
}

func migrationRecordCount(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var count int64
	require.NoError(t, db.Table("schema_migrations").Count(&count).Error)
	return count
}

func TestSQLiteSchemaMigrationsFromEmptyDatabase(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	require.NoError(t, RunSchemaMigrations(db))

	require.EqualValues(t, len(productionSchemaMigrations()), migrationRecordCount(t, db))
	for _, table := range []string{
		"billing_ledgers",
		"billing_requests",
		"billing_jobs",
		"tasks",
		"midjourneys",
		"sandbox_executions",
		"stripe_payment_orders",
		"stripe_webhook_events",
		"payment_credit_ledgers",
		"tokens",
	} {
		require.True(t, db.Migrator().HasTable(table), table)
	}
}

func TestSQLiteSchemaMigrationsAfterApplicationAutoMigrate(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&Token{},
		&Midjourney{},
		&Task{},
		&BillingRequest{},
		&BillingLedger{},
		&BillingJob{},
		&StripePaymentOrder{},
		&StripeWebhookEvent{},
		&PaymentCreditLedger{},
		&PaymentAudit{},
		&SandboxExecution{},
	))

	require.NoError(t, RunSchemaMigrations(db))
	require.EqualValues(t, len(productionSchemaMigrations()), migrationRecordCount(t, db))
}

func TestSQLiteSchemaMigrationsPreserveExistingData(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE billing_ledgers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			operation_key VARCHAR(128) NOT NULL,
			request_id VARCHAR(64) NOT NULL,
			operation VARCHAR(32) NOT NULL,
			funding_source VARCHAR(32) NOT NULL,
			user_id INTEGER NOT NULL,
			token_id INTEGER NOT NULL DEFAULT 0,
			amount INTEGER NOT NULL,
			wallet_before INTEGER NOT NULL,
			wallet_after INTEGER NOT NULL,
			token_remain_before INTEGER NOT NULL DEFAULT 0,
			token_remain_after INTEGER NOT NULL DEFAULT 0,
			token_used_before INTEGER NOT NULL DEFAULT 0,
			token_used_after INTEGER NOT NULL DEFAULT 0,
			token_unlimited NUMERIC NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		);
		INSERT INTO billing_ledgers (
			operation_key, request_id, operation, funding_source, user_id, token_id,
			amount, wallet_before, wallet_after, token_remain_before, token_remain_after,
			token_used_before, token_used_after, token_unlimited, created_at
		) VALUES ('legacy:reserve', 'legacy-request', 'reserve', 'wallet', 1, 2,
			10, 100, 90, 100, 90, 0, 10, 0, 1);

		CREATE TABLE tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			task_id VARCHAR(191) NOT NULL,
			user_id INTEGER NOT NULL,
			status VARCHAR(20) NOT NULL,
			progress VARCHAR(20) NOT NULL
		);
		INSERT INTO tasks (task_id, user_id, status, progress)
			VALUES ('legacy-task', 1, 'IN_PROGRESS', '50%');

		CREATE TABLE midjourneys (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			mj_id VARCHAR(191) NOT NULL,
			user_id INTEGER NOT NULL,
			status VARCHAR(20) NOT NULL,
			progress VARCHAR(30) NOT NULL
		);
		INSERT INTO midjourneys (mj_id, user_id, status, progress)
			VALUES ('legacy-mj', 1, 'IN_PROGRESS', '25%');

		CREATE TABLE tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			"key" TEXT NOT NULL,
			status INTEGER NOT NULL DEFAULT 1,
			name TEXT NOT NULL DEFAULT '',
			expired_time INTEGER NOT NULL DEFAULT -1
		);
		INSERT INTO tokens (user_id, "key", name)
			VALUES (1, 'legacy-api-key', 'legacy');
	`).Error)

	require.NoError(t, RunSchemaMigrations(db))

	for table, predicate := range map[string]string{
		"billing_ledgers": "operation_key = 'legacy:reserve'",
		"tasks":           "task_id = 'legacy-task'",
		"midjourneys":     "mj_id = 'legacy-mj'",
		"tokens":          `"key" = 'legacy-api-key'`,
	} {
		var count int64
		require.NoError(t, db.Table(table).Where(predicate).Count(&count).Error)
		require.EqualValues(t, 1, count, table)
	}
}

func TestSQLiteSchemaMigrationsAreRepeatable(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	require.NoError(t, RunSchemaMigrations(db))
	firstCount := migrationRecordCount(t, db)
	require.NoError(t, RunSchemaMigrations(db))
	require.Equal(t, firstCount, migrationRecordCount(t, db))

	migration := productionSchemaMigrations()[2]
	require.NoError(t, runSchemaMigration(db, migration))
	require.Equal(t, firstCount, migrationRecordCount(t, db))
}

func TestSQLiteSchemaMigrationBackfillsMatchingExistingSchema(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	require.NoError(t, RunSchemaMigrations(db))
	target := productionSchemaMigrations()[2]
	require.NoError(t, db.Where("version = ?", target.Version).Delete(&SchemaMigration{}).Error)

	require.NoError(t, runSchemaMigration(db, target))

	var record SchemaMigration
	require.NoError(t, db.Where("version = ?", target.Version).First(&record).Error)
	require.Equal(t, target.Checksum, record.Checksum)
}

func TestSQLiteSchemaMigrationRejectsMismatchedColumnAndIndex(t *testing.T) {
	t.Run("column type", func(t *testing.T) {
		db := newSchemaMigrationTestDB(t)
		require.NoError(t, db.Exec(`
			CREATE TABLE billing_ledgers (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				operation_key VARCHAR(128) NOT NULL,
				request_id VARCHAR(64) NOT NULL,
				operation VARCHAR(32) NOT NULL,
				funding_source VARCHAR(32) NOT NULL,
				user_id INTEGER NOT NULL,
				token_id INTEGER NOT NULL DEFAULT 0,
				subscription_id TEXT NOT NULL DEFAULT '',
				amount INTEGER NOT NULL,
				wallet_before INTEGER NOT NULL,
				wallet_after INTEGER NOT NULL,
				token_remain_before INTEGER NOT NULL DEFAULT 0,
				token_remain_after INTEGER NOT NULL DEFAULT 0,
				token_used_before INTEGER NOT NULL DEFAULT 0,
				token_used_after INTEGER NOT NULL DEFAULT 0,
				token_unlimited NUMERIC NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL
			)
		`).Error)
		err := runSchemaMigration(db, productionSchemaMigrations()[2])
		require.ErrorContains(t, err, "subscription_id")
	})

	t.Run("index definition", func(t *testing.T) {
		db := newSchemaMigrationTestDB(t)
		require.NoError(t, RunSchemaMigrations(db))
		target := productionSchemaMigrations()[5]
		require.NoError(t, db.Where("version = ?", target.Version).Delete(&SchemaMigration{}).Error)
		require.NoError(t, db.Exec("DROP INDEX idx_tokens_public_id_unique").Error)
		require.NoError(t, db.Exec("CREATE INDEX idx_tokens_public_id_unique ON tokens(public_id)").Error)

		err := runSchemaMigration(db, target)
		require.ErrorContains(t, err, "idx_tokens_public_id_unique")
	})
}

func TestSQLiteSchemaMigrationResumesPartialSchema(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE billing_ledgers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			operation_key VARCHAR(128) NOT NULL,
			request_id VARCHAR(64) NOT NULL,
			operation VARCHAR(32) NOT NULL,
			funding_source VARCHAR(32) NOT NULL,
			user_id INTEGER NOT NULL,
			token_id INTEGER NOT NULL DEFAULT 0,
			subscription_id INTEGER NOT NULL DEFAULT 0,
			amount INTEGER NOT NULL,
			target_quota INTEGER NOT NULL DEFAULT 0,
			wallet_before INTEGER NOT NULL,
			wallet_after INTEGER NOT NULL,
			token_remain_before INTEGER NOT NULL DEFAULT 0,
			token_remain_after INTEGER NOT NULL DEFAULT 0,
			token_used_before INTEGER NOT NULL DEFAULT 0,
			token_used_after INTEGER NOT NULL DEFAULT 0,
			token_unlimited NUMERIC NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)
	`).Error)

	require.NoError(t, runSchemaMigration(db, productionSchemaMigrations()[2]))
	for _, column := range []string{
		"actual_quota",
		"subscription_used_before",
		"subscription_used_after",
		"request_status_before",
		"request_status_after",
	} {
		require.True(t, db.Migrator().HasColumn("billing_ledgers", column), column)
	}
}

func TestSQLiteSchemaMigrationConcurrentRunners(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	const runners = 2
	errs := make(chan error, runners)
	var wg sync.WaitGroup
	for i := 0; i < runners; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- RunSchemaMigrations(db)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	require.EqualValues(t, len(productionSchemaMigrations()), migrationRecordCount(t, db))
}

func TestSQLiteSchemaMigrationRejectsVersionAndChecksumConflict(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	require.NoError(t, ensureSchemaMigrationTables(db))
	target := productionSchemaMigrations()[0]
	require.NoError(t, db.Create(&SchemaMigration{
		Version:   target.Version,
		Name:      "different-name",
		Checksum:  strings.Repeat("0", 64),
		AppliedAt: 1,
	}).Error)

	err := runSchemaMigration(db, target)
	require.ErrorContains(t, err, "checksum")
}

func TestSQLiteSchemaMigrationFailureDoesNotRecordVersion(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	migration := schemaMigrationDefinition{
		Version:  "test_failure",
		Name:     "forced failure",
		Checksum: strings.Repeat("f", 64),
		Apply: func(tx *gorm.DB) error {
			if err := tx.Exec("CREATE TABLE migration_failure_probe (id INTEGER PRIMARY KEY)").Error; err != nil {
				return err
			}
			return fmt.Errorf("forced migration failure")
		},
		Validate: func(*gorm.DB) error {
			return nil
		},
	}

	require.ErrorContains(t, runSchemaMigration(db, migration), "forced migration failure")
	require.False(t, db.Migrator().HasTable("migration_failure_probe"))
	var count int64
	require.NoError(t, db.Table("schema_migrations").Where("version = ?", migration.Version).Count(&count).Error)
	require.Zero(t, count)

	migration.Apply = func(tx *gorm.DB) error {
		return tx.Exec("CREATE TABLE migration_failure_probe (id INTEGER PRIMARY KEY)").Error
	}
	require.NoError(t, runSchemaMigration(db, migration))
	require.True(t, db.Migrator().HasTable("migration_failure_probe"))
}

func TestSQLiteSchemaMigrationsPreserveBillingStripeAndAPIKeyData(t *testing.T) {
	db := newSchemaMigrationTestDB(t)
	require.NoError(t, RunSchemaMigrations(db))
	require.NoError(t, db.Exec(`
		INSERT INTO billing_ledgers (
			operation_key, request_id, operation, funding_source, user_id, token_id,
			subscription_id, amount, target_quota, actual_quota, wallet_before,
			wallet_after, token_remain_before, token_remain_after, token_used_before,
			token_used_after, token_unlimited, subscription_used_before,
			subscription_used_after, request_status_before, request_status_after, created_at
		) VALUES (
			'preserve:billing', 'preserve-request', 'reserve', 'wallet', 1, 2,
			0, 10, 10, 0, 100, 90, 100, 90, 0, 10, 0, 0, 0, '', 'reserved', 1
		);
		INSERT INTO stripe_payment_orders (
			order_no, order_kind, user_id, status, expected_amount_minor, currency,
			checkout_success_url, checkout_cancel_url, checkout_url,
			price_config_version, price_snapshot, idempotency_key, last_error,
			created_at, updated_at
		) VALUES (
			'preserve-order', 'topup', 1, 'created', 100, 'usd',
			'https://example.com/success', 'https://example.com/cancel', '',
			'v1', '{}', 'stripe:checkout:preserve-order', '', 1, 1
		);
		INSERT INTO tokens (
			user_id, "key", status, name, expired_time, public_id, key_prefix,
			key_hash, legacy_lookup_hash, last_four, key_version, scopes,
			revoked_at, migrated_at
		) VALUES (
			1, 'preserve-legacy-key', 1, 'legacy', -1, '', 'preserve-leg',
			'', '', '-key', 0, '', 0, 0
		);
	`).Error)

	require.NoError(t, RunSchemaMigrations(db))

	for table, predicate := range map[string]string{
		"billing_ledgers":       "operation_key = 'preserve:billing'",
		"stripe_payment_orders": "order_no = 'preserve-order'",
		"tokens":                `"key" = 'preserve-legacy-key'`,
	} {
		var count int64
		require.NoError(t, db.Table(table).Where(predicate).Count(&count).Error)
		require.EqualValues(t, 1, count, table)
	}
}

func TestSchemaMigrationMetadataDDLUsesSameRecordSemantics(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		content, err := embeddedmigrations.Read(dialect, "20260714_00_schema_migrations")
		require.NoError(t, err, dialect)
		normalized := strings.ToLower(string(content))
		for _, required := range []string{
			"schema_migrations",
			"version",
			"name",
			"checksum",
			"applied_at",
			"schema_migration_locks",
		} {
			require.Contains(t, normalized, required, dialect)
		}
	}
}
