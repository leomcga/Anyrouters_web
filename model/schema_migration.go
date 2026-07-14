package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/migrations"
	"gorm.io/gorm"
)

const schemaMigrationLockID = 1

type SchemaMigration struct {
	Version   string `gorm:"type:varchar(64);primaryKey"`
	Name      string `gorm:"type:varchar(255);not null"`
	Checksum  string `gorm:"type:char(64);not null"`
	AppliedAt int64  `gorm:"type:bigint;not null"`
}

type schemaMigrationLock struct {
	ID        int   `gorm:"primaryKey"`
	UpdatedAt int64 `gorm:"type:bigint;not null"`
}

type schemaMigrationDefinition struct {
	Version  string
	Name     string
	Checksum string
	Apply    func(*gorm.DB) error
	Validate func(*gorm.DB) error
}

type sqliteColumnExpectation struct {
	Name       string
	Type       string
	NotNull    bool
	Default    string
	Definition string
}

type sqliteIndexExpectation struct {
	Name    string
	Table   string
	Columns []string
	Unique  bool
	Where   string
	Create  string
}

type sqliteColumnInfo struct {
	CID        int
	Name       string
	Type       string
	NotNull    int     `gorm:"column:notnull"`
	Default    *string `gorm:"column:dflt_value"`
	PrimaryKey int     `gorm:"column:pk"`
}

type sqliteIndexInfo struct {
	Sequence int    `gorm:"column:seq"`
	Name     string `gorm:"column:name"`
	Unique   int    `gorm:"column:unique"`
	Origin   string `gorm:"column:origin"`
	Partial  int    `gorm:"column:partial"`
}

var whitespacePattern = regexp.MustCompile(`\s+`)

func (SchemaMigration) TableName() string {
	return "schema_migrations"
}

func (schemaMigrationLock) TableName() string {
	return "schema_migration_locks"
}

func RunSchemaMigrations(db *gorm.DB) error {
	if db == nil {
		return errors.New("schema migration database is nil")
	}
	if err := ensureSchemaMigrationTables(db); err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := acquireSchemaMigrationLock(tx); err != nil {
			return err
		}
		for _, migration := range productionSchemaMigrationsForDB(tx) {
			if err := runSchemaMigrationTx(tx, migration); err != nil {
				return err
			}
		}
		return nil
	})
}

func runSchemaMigration(db *gorm.DB, migration schemaMigrationDefinition) error {
	if err := ensureSchemaMigrationTables(db); err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := acquireSchemaMigrationLock(tx); err != nil {
			return err
		}
		return runSchemaMigrationTx(tx, migration)
	})
}

func runSchemaMigrationTx(tx *gorm.DB, migration schemaMigrationDefinition) error {
	var applied SchemaMigration
	query := tx.Where("version = ?", migration.Version).Limit(1).Find(&applied)
	if query.Error != nil {
		return fmt.Errorf("read schema migration %s: %w", migration.Version, query.Error)
	}
	if query.RowsAffected > 0 {
		if applied.Checksum != migration.Checksum {
			return fmt.Errorf(
				"schema migration %s checksum conflict: database=%s expected=%s",
				migration.Version,
				applied.Checksum,
				migration.Checksum,
			)
		}
		if applied.Name != migration.Name {
			return fmt.Errorf(
				"schema migration %s name conflict: database=%q expected=%q",
				migration.Version,
				applied.Name,
				migration.Name,
			)
		}
		return migration.Validate(tx)
	}

	if err := migration.Apply(tx); err != nil {
		return fmt.Errorf("apply schema migration %s (%s): %w", migration.Version, migration.Name, err)
	}
	if err := migration.Validate(tx); err != nil {
		return fmt.Errorf("validate schema migration %s (%s): %w", migration.Version, migration.Name, err)
	}
	record := SchemaMigration{
		Version:   migration.Version,
		Name:      migration.Name,
		Checksum:  migration.Checksum,
		AppliedAt: time.Now().Unix(),
	}
	if err := tx.Create(&record).Error; err != nil {
		return fmt.Errorf("record schema migration %s: %w", migration.Version, err)
	}
	return nil
}

func ensureSchemaMigrationTables(db *gorm.DB) error {
	var statements []string
	switch db.Dialector.Name() {
	case "mysql":
		statements = []string{
			`CREATE TABLE IF NOT EXISTS schema_migrations (
				version VARCHAR(64) NOT NULL PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				checksum CHAR(64) NOT NULL,
				applied_at BIGINT NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS schema_migration_locks (
				id INTEGER NOT NULL PRIMARY KEY,
				updated_at BIGINT NOT NULL
			)`,
			`INSERT IGNORE INTO schema_migration_locks (id, updated_at) VALUES (1, 0)`,
		}
	default:
		statements = []string{
			`CREATE TABLE IF NOT EXISTS schema_migrations (
				version VARCHAR(64) NOT NULL PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				checksum CHAR(64) NOT NULL,
				applied_at BIGINT NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS schema_migration_locks (
				id INTEGER NOT NULL PRIMARY KEY,
				updated_at BIGINT NOT NULL
			)`,
			`INSERT INTO schema_migration_locks (id, updated_at)
			 VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
		}
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			return fmt.Errorf("create schema migration metadata tables: %w", err)
		}
	}
	return nil
}

func acquireSchemaMigrationLock(tx *gorm.DB) error {
	result := tx.Model(&schemaMigrationLock{}).
		Where("id = ?", schemaMigrationLockID).
		UpdateColumn("updated_at", time.Now().UnixNano())
	if result.Error != nil {
		return fmt.Errorf("acquire schema migration database lock: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return errors.New("acquire schema migration database lock: lock row is missing")
	}
	return nil
}

func productionSchemaMigrations() []schemaMigrationDefinition {
	return productionSchemaMigrationsForDialect("sqlite")
}

func productionSchemaMigrationsForDB(db *gorm.DB) []schemaMigrationDefinition {
	return productionSchemaMigrationsForDialect(db.Dialector.Name())
}

func productionSchemaMigrationsForDialect(dialect string) []schemaMigrationDefinition {
	names := []struct {
		Version string
		Name    string
	}{
		{"20260713_01", "20260713_create_billing_ledgers"},
		{"20260713_02", "20260713_02_create_billing_requests_jobs"},
		{"20260713_03", "20260713_03_expand_billing_ledgers"},
		{"20260713_04", "20260713_04_async_task_billing_state"},
		{"20260713_05", "20260713_05_stripe_payment_safety"},
		{"20260714_06", "20260714_06_api_key_security"},
	}
	result := make([]schemaMigrationDefinition, 0, len(names))
	for _, item := range names {
		sqlBytes, err := migrations.Read(dialectDirectory(dialect), item.Name)
		if err != nil {
			result = append(result, schemaMigrationDefinition{
				Version: item.Version,
				Name:    item.Name,
				Apply: func(*gorm.DB) error {
					return err
				},
				Validate: func(*gorm.DB) error {
					return err
				},
			})
			continue
		}
		sum := sha256.Sum256(sqlBytes)
		migration := schemaMigrationDefinition{
			Version:  item.Version,
			Name:     item.Name,
			Checksum: hex.EncodeToString(sum[:]),
		}
		if dialect == "sqlite" {
			configureSQLiteMigration(&migration, string(sqlBytes))
		} else {
			migration.Apply = func(db *gorm.DB) error {
				return db.Exec(string(sqlBytes)).Error
			}
			migration.Validate = func(*gorm.DB) error {
				return nil
			}
		}
		result = append(result, migration)
	}
	return result
}

func dialectDirectory(dialect string) string {
	switch dialect {
	case "postgres":
		return "postgres"
	case "mysql":
		return "mysql"
	default:
		return "sqlite"
	}
}

func configureSQLiteMigration(migration *schemaMigrationDefinition, sqlText string) {
	switch migration.Version {
	case "20260713_01":
		migration.Apply = executeSQLiteSQL(sqlText)
		migration.Validate = validateSQLiteBillingLedgerBase
	case "20260713_02":
		migration.Apply = executeSQLiteSQL(sqlText)
		migration.Validate = validateSQLiteBillingRequestJobSchema
	case "20260713_03":
		migration.Apply = applySQLiteBillingLedgerExpansion
		migration.Validate = validateSQLiteBillingLedgerExpansion
	case "20260713_04":
		migration.Apply = applySQLiteAsyncTaskBillingState
		migration.Validate = validateSQLiteAsyncTaskBillingState
	case "20260713_05":
		migration.Apply = executeSQLiteSQL(sqlText)
		migration.Validate = validateSQLiteStripeSchema
	case "20260714_06":
		migration.Apply = applySQLiteAPIKeySecurity
		migration.Validate = validateSQLiteAPIKeySecurity
	}
}

func executeSQLiteSQL(sqlText string) func(*gorm.DB) error {
	return func(db *gorm.DB) error {
		return db.Exec(sqlText).Error
	}
}

func validateSQLiteBillingLedgerBase(db *gorm.DB) error {
	if !db.Migrator().HasTable("billing_ledgers") {
		return errors.New("billing_ledgers table is missing")
	}
	return validateSQLiteIndexes(db, []sqliteIndexExpectation{
		{
			Name: "idx_billing_ledgers_operation_key", Table: "billing_ledgers",
			Columns: []string{"operation_key"}, Unique: true,
		},
	})
}

func validateSQLiteBillingRequestJobSchema(db *gorm.DB) error {
	for _, table := range []string{"billing_requests", "billing_jobs"} {
		if !db.Migrator().HasTable(table) {
			return fmt.Errorf("%s table is missing", table)
		}
	}
	return validateSQLiteIndexes(db, []sqliteIndexExpectation{
		{
			Name: "idx_billing_requests_request_id", Table: "billing_requests",
			Columns: []string{"request_id"}, Unique: true,
		},
		{
			Name: "idx_billing_jobs_operation_key", Table: "billing_jobs",
			Columns: []string{"operation_key"}, Unique: true,
		},
	})
}

func billingLedgerExpansionColumns() []sqliteColumnExpectation {
	return []sqliteColumnExpectation{
		{Name: "subscription_id", Type: "INTEGER", NotNull: true, Default: "0", Definition: "subscription_id INTEGER NOT NULL DEFAULT 0"},
		{Name: "target_quota", Type: "INTEGER", NotNull: true, Default: "0", Definition: "target_quota INTEGER NOT NULL DEFAULT 0"},
		{Name: "actual_quota", Type: "INTEGER", NotNull: true, Default: "0", Definition: "actual_quota INTEGER NOT NULL DEFAULT 0"},
		{Name: "subscription_used_before", Type: "INTEGER", NotNull: true, Default: "0", Definition: "subscription_used_before INTEGER NOT NULL DEFAULT 0"},
		{Name: "subscription_used_after", Type: "INTEGER", NotNull: true, Default: "0", Definition: "subscription_used_after INTEGER NOT NULL DEFAULT 0"},
		{Name: "request_status_before", Type: "VARCHAR(32)", NotNull: true, Default: "''", Definition: "request_status_before VARCHAR(32) NOT NULL DEFAULT ''"},
		{Name: "request_status_after", Type: "VARCHAR(32)", NotNull: true, Default: "''", Definition: "request_status_after VARCHAR(32) NOT NULL DEFAULT ''"},
	}
}

func applySQLiteBillingLedgerExpansion(db *gorm.DB) error {
	if !db.Migrator().HasTable("billing_ledgers") {
		sqlBytes, err := migrations.Read("sqlite", "20260713_create_billing_ledgers")
		if err != nil {
			return err
		}
		if err := db.Exec(string(sqlBytes)).Error; err != nil {
			return err
		}
	}
	if err := ensureSQLiteColumns(db, "billing_ledgers", billingLedgerExpansionColumns()); err != nil {
		return err
	}
	return ensureSQLiteIndex(db, sqliteIndexExpectation{
		Name: "idx_billing_ledgers_subscription_id", Table: "billing_ledgers",
		Columns: []string{"subscription_id"},
		Create:  "CREATE INDEX idx_billing_ledgers_subscription_id ON billing_ledgers(subscription_id)",
	})
}

func validateSQLiteBillingLedgerExpansion(db *gorm.DB) error {
	if err := validateSQLiteColumns(db, "billing_ledgers", billingLedgerExpansionColumns()); err != nil {
		return err
	}
	return validateSQLiteIndexes(db, []sqliteIndexExpectation{
		{
			Name: "idx_billing_ledgers_subscription_id", Table: "billing_ledgers",
			Columns: []string{"subscription_id"},
		},
	})
}

func taskBillingColumns() []sqliteColumnExpectation {
	return []sqliteColumnExpectation{
		{Name: "request_id", Type: "VARCHAR(64)", Definition: "request_id VARCHAR(64)"},
		{Name: "billing_request_id", Type: "INTEGER", Definition: "billing_request_id INTEGER"},
		{Name: "upstream_task_id", Type: "VARCHAR(191)", NotNull: true, Default: "''", Definition: "upstream_task_id VARCHAR(191) NOT NULL DEFAULT ''"},
		{Name: "submit_attempt", Type: "INTEGER", NotNull: true, Default: "1", Definition: "submit_attempt INTEGER NOT NULL DEFAULT 1"},
		{Name: "upstream_status", Type: "VARCHAR(20)", NotNull: true, Default: "''", Definition: "upstream_status VARCHAR(20) NOT NULL DEFAULT ''"},
		{Name: "billing_status", Type: "VARCHAR(32)", NotNull: true, Default: "''", Definition: "billing_status VARCHAR(32) NOT NULL DEFAULT ''"},
		{Name: "upstream_result_persisted", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "upstream_result_persisted NUMERIC NOT NULL DEFAULT 0"},
		{Name: "price_snapshot_persisted", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "price_snapshot_persisted NUMERIC NOT NULL DEFAULT 0"},
		{Name: "usage_total", Type: "INTEGER", NotNull: true, Default: "0", Definition: "usage_total INTEGER NOT NULL DEFAULT 0"},
		{Name: "usage_available", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "usage_available NUMERIC NOT NULL DEFAULT 0"},
		{Name: "usage_estimated", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "usage_estimated NUMERIC NOT NULL DEFAULT 0"},
		{Name: "usage_basis", Type: "VARCHAR(64)", NotNull: true, Default: "''", Definition: "usage_basis VARCHAR(64) NOT NULL DEFAULT ''"},
		{Name: "usage_wait_until", Type: "INTEGER", NotNull: true, Default: "0", Definition: "usage_wait_until INTEGER NOT NULL DEFAULT 0"},
		{Name: "final_quota", Type: "INTEGER", NotNull: true, Default: "0", Definition: "final_quota INTEGER NOT NULL DEFAULT 0"},
		{Name: "final_quota_determined", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "final_quota_determined NUMERIC NOT NULL DEFAULT 0"},
		{Name: "billing_last_error", Type: "TEXT", Definition: "billing_last_error TEXT"},
		{Name: "usage_accounted", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "usage_accounted NUMERIC NOT NULL DEFAULT 0"},
		{Name: "version", Type: "INTEGER", NotNull: true, Default: "1", Definition: "version INTEGER NOT NULL DEFAULT 1"},
		{Name: "locked_by", Type: "VARCHAR(128)", NotNull: true, Default: "''", Definition: "locked_by VARCHAR(128) NOT NULL DEFAULT ''"},
		{Name: "locked_until", Type: "INTEGER", NotNull: true, Default: "0", Definition: "locked_until INTEGER NOT NULL DEFAULT 0"},
	}
}

func midjourneyBillingColumns() []sqliteColumnExpectation {
	return []sqliteColumnExpectation{
		{Name: "request_id", Type: "VARCHAR(64)", Definition: "request_id VARCHAR(64)"},
		{Name: "billing_request_id", Type: "INTEGER", Definition: "billing_request_id INTEGER"},
		{Name: "upstream_status", Type: "VARCHAR(20)", NotNull: true, Default: "''", Definition: "upstream_status VARCHAR(20) NOT NULL DEFAULT ''"},
		{Name: "billing_status", Type: "VARCHAR(32)", NotNull: true, Default: "''", Definition: "billing_status VARCHAR(32) NOT NULL DEFAULT ''"},
		{Name: "upstream_result_persisted", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "upstream_result_persisted NUMERIC NOT NULL DEFAULT 0"},
		{Name: "price_snapshot_persisted", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "price_snapshot_persisted NUMERIC NOT NULL DEFAULT 0"},
		{Name: "billing_snapshot", Type: "TEXT", Definition: "billing_snapshot TEXT"},
		{Name: "submit_attempt", Type: "INTEGER", NotNull: true, Default: "1", Definition: "submit_attempt INTEGER NOT NULL DEFAULT 1"},
		{Name: "final_quota", Type: "INTEGER", NotNull: true, Default: "0", Definition: "final_quota INTEGER NOT NULL DEFAULT 0"},
		{Name: "final_quota_determined", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "final_quota_determined NUMERIC NOT NULL DEFAULT 0"},
		{Name: "billing_last_error", Type: "TEXT", Definition: "billing_last_error TEXT"},
		{Name: "usage_accounted", Type: "NUMERIC", NotNull: true, Default: "0", Definition: "usage_accounted NUMERIC NOT NULL DEFAULT 0"},
		{Name: "version", Type: "INTEGER", NotNull: true, Default: "1", Definition: "version INTEGER NOT NULL DEFAULT 1"},
		{Name: "locked_by", Type: "VARCHAR(128)", NotNull: true, Default: "''", Definition: "locked_by VARCHAR(128) NOT NULL DEFAULT ''"},
		{Name: "locked_until", Type: "INTEGER", NotNull: true, Default: "0", Definition: "locked_until INTEGER NOT NULL DEFAULT 0"},
	}
}

func applySQLiteAsyncTaskBillingState(db *gorm.DB) error {
	if !db.Migrator().HasTable("tasks") {
		if err := db.Exec(`CREATE TABLE tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			task_id VARCHAR(191) NOT NULL DEFAULT '',
			user_id INTEGER NOT NULL DEFAULT 0,
			status VARCHAR(20) NOT NULL DEFAULT '',
			progress VARCHAR(20) NOT NULL DEFAULT ''
		)`).Error; err != nil {
			return err
		}
	}
	if !db.Migrator().HasTable("midjourneys") {
		if err := db.Exec(`CREATE TABLE midjourneys (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			mj_id VARCHAR(191) NOT NULL DEFAULT '',
			user_id INTEGER NOT NULL DEFAULT 0,
			status VARCHAR(20) NOT NULL DEFAULT '',
			progress VARCHAR(30) NOT NULL DEFAULT ''
		)`).Error; err != nil {
			return err
		}
	}
	if err := ensureSQLiteColumns(db, "tasks", taskBillingColumns()); err != nil {
		return err
	}
	if err := ensureSQLiteColumns(db, "midjourneys", midjourneyBillingColumns()); err != nil {
		return err
	}
	indexes := asyncTaskSQLiteIndexes()
	for _, index := range indexes {
		if err := ensureSQLiteIndex(db, index); err != nil {
			return err
		}
	}
	if !db.Migrator().HasTable("sandbox_executions") {
		if err := db.Exec(`CREATE TABLE sandbox_executions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			request_id VARCHAR(64) NOT NULL,
			user_id INTEGER NOT NULL,
			day VARCHAR(8) NOT NULL,
			ordinal INTEGER NOT NULL,
			is_free NUMERIC NOT NULL,
			quota INTEGER NOT NULL DEFAULT 0,
			status VARCHAR(24) NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`).Error; err != nil {
			return err
		}
	}
	for _, index := range sandboxExecutionSQLiteIndexes() {
		if err := ensureSQLiteIndex(db, index); err != nil {
			return err
		}
	}
	return nil
}

func asyncTaskSQLiteIndexes() []sqliteIndexExpectation {
	return []sqliteIndexExpectation{
		{Name: "idx_tasks_request_id", Table: "tasks", Columns: []string{"request_id"}, Unique: true, Where: "request_id IS NOT NULL", Create: "CREATE UNIQUE INDEX idx_tasks_request_id ON tasks(request_id) WHERE request_id IS NOT NULL"},
		{Name: "idx_tasks_billing_request_id", Table: "tasks", Columns: []string{"billing_request_id"}, Unique: true, Where: "billing_request_id IS NOT NULL", Create: "CREATE UNIQUE INDEX idx_tasks_billing_request_id ON tasks(billing_request_id) WHERE billing_request_id IS NOT NULL"},
		{Name: "idx_tasks_upstream_task_id", Table: "tasks", Columns: []string{"upstream_task_id"}, Create: "CREATE INDEX idx_tasks_upstream_task_id ON tasks(upstream_task_id)"},
		{Name: "idx_tasks_upstream_billing", Table: "tasks", Columns: []string{"upstream_status", "billing_status"}, Create: "CREATE INDEX idx_tasks_upstream_billing ON tasks(upstream_status, billing_status)"},
		{Name: "idx_tasks_usage_wait_until", Table: "tasks", Columns: []string{"usage_wait_until"}, Create: "CREATE INDEX idx_tasks_usage_wait_until ON tasks(usage_wait_until)"},
		{Name: "idx_tasks_locked_until", Table: "tasks", Columns: []string{"locked_until"}, Create: "CREATE INDEX idx_tasks_locked_until ON tasks(locked_until)"},
		{Name: "idx_midjourneys_request_id", Table: "midjourneys", Columns: []string{"request_id"}, Unique: true, Where: "request_id IS NOT NULL", Create: "CREATE UNIQUE INDEX idx_midjourneys_request_id ON midjourneys(request_id) WHERE request_id IS NOT NULL"},
		{Name: "idx_midjourneys_billing_request_id", Table: "midjourneys", Columns: []string{"billing_request_id"}, Unique: true, Where: "billing_request_id IS NOT NULL", Create: "CREATE UNIQUE INDEX idx_midjourneys_billing_request_id ON midjourneys(billing_request_id) WHERE billing_request_id IS NOT NULL"},
		{Name: "idx_midjourneys_upstream_billing", Table: "midjourneys", Columns: []string{"upstream_status", "billing_status"}, Create: "CREATE INDEX idx_midjourneys_upstream_billing ON midjourneys(upstream_status, billing_status)"},
		{Name: "idx_midjourneys_locked_until", Table: "midjourneys", Columns: []string{"locked_until"}, Create: "CREATE INDEX idx_midjourneys_locked_until ON midjourneys(locked_until)"},
	}
}

func sandboxExecutionSQLiteIndexes() []sqliteIndexExpectation {
	return []sqliteIndexExpectation{
		{Name: "idx_sandbox_executions_request_id", Table: "sandbox_executions", Columns: []string{"request_id"}, Unique: true, Create: "CREATE UNIQUE INDEX idx_sandbox_executions_request_id ON sandbox_executions(request_id)"},
		{Name: "idx_sandbox_executions_user_day", Table: "sandbox_executions", Columns: []string{"user_id", "day"}, Create: "CREATE INDEX idx_sandbox_executions_user_day ON sandbox_executions(user_id, day)"},
		{Name: "idx_sandbox_executions_status_created", Table: "sandbox_executions", Columns: []string{"status", "created_at"}, Create: "CREATE INDEX idx_sandbox_executions_status_created ON sandbox_executions(status, created_at)"},
	}
}

func validateSQLiteAsyncTaskBillingState(db *gorm.DB) error {
	if err := validateSQLiteColumns(db, "tasks", taskBillingColumns()); err != nil {
		return err
	}
	if err := validateSQLiteColumns(db, "midjourneys", midjourneyBillingColumns()); err != nil {
		return err
	}
	if !db.Migrator().HasTable("sandbox_executions") {
		return errors.New("sandbox_executions table is missing")
	}
	indexes := append(asyncTaskSQLiteIndexes(), sandboxExecutionSQLiteIndexes()...)
	return validateSQLiteIndexes(db, indexes)
}

func validateSQLiteStripeSchema(db *gorm.DB) error {
	return VerifyStripePaymentSchema(db)
}

func apiKeySecurityColumns() []sqliteColumnExpectation {
	return []sqliteColumnExpectation{
		{Name: "public_id", Type: "TEXT", NotNull: true, Default: "''", Definition: "public_id TEXT NOT NULL DEFAULT ''"},
		{Name: "key_prefix", Type: "TEXT", NotNull: true, Default: "''", Definition: "key_prefix TEXT NOT NULL DEFAULT ''"},
		{Name: "key_hash", Type: "TEXT", NotNull: true, Default: "''", Definition: "key_hash TEXT NOT NULL DEFAULT ''"},
		{Name: "legacy_lookup_hash", Type: "TEXT", NotNull: true, Default: "''", Definition: "legacy_lookup_hash TEXT NOT NULL DEFAULT ''"},
		{Name: "last_four", Type: "TEXT", NotNull: true, Default: "''", Definition: "last_four TEXT NOT NULL DEFAULT ''"},
		{Name: "key_version", Type: "INTEGER", NotNull: true, Default: "0", Definition: "key_version INTEGER NOT NULL DEFAULT 0"},
		{Name: "scopes", Type: "TEXT", NotNull: true, Default: "''", Definition: "scopes TEXT NOT NULL DEFAULT ''"},
		{Name: "revoked_at", Type: "INTEGER", NotNull: true, Default: "0", Definition: "revoked_at INTEGER NOT NULL DEFAULT 0"},
		{Name: "migrated_at", Type: "INTEGER", NotNull: true, Default: "0", Definition: "migrated_at INTEGER NOT NULL DEFAULT 0"},
	}
}

func apiKeySecurityIndexes() []sqliteIndexExpectation {
	return []sqliteIndexExpectation{
		{Name: "idx_tokens_public_id_unique", Table: "tokens", Columns: []string{"public_id"}, Unique: true, Where: "public_id <> ''", Create: "CREATE UNIQUE INDEX idx_tokens_public_id_unique ON tokens(public_id) WHERE public_id <> ''"},
		{Name: "idx_tokens_legacy_lookup_unique", Table: "tokens", Columns: []string{"legacy_lookup_hash"}, Unique: true, Where: "legacy_lookup_hash <> ''", Create: "CREATE UNIQUE INDEX idx_tokens_legacy_lookup_unique ON tokens(legacy_lookup_hash) WHERE legacy_lookup_hash <> ''"},
		{Name: "idx_tokens_security_state", Table: "tokens", Columns: []string{"user_id", "status", "revoked_at", "expired_time"}, Create: "CREATE INDEX idx_tokens_security_state ON tokens(user_id, status, revoked_at, expired_time)"},
	}
}

func applySQLiteAPIKeySecurity(db *gorm.DB) error {
	if !db.Migrator().HasTable("tokens") {
		if err := db.Exec(`CREATE TABLE tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL DEFAULT 0,
			"key" TEXT NOT NULL DEFAULT '',
			status INTEGER NOT NULL DEFAULT 1,
			name TEXT NOT NULL DEFAULT '',
			expired_time INTEGER NOT NULL DEFAULT -1
		)`).Error; err != nil {
			return err
		}
	}
	if err := ensureSQLiteColumns(db, "tokens", apiKeySecurityColumns()); err != nil {
		return err
	}
	if err := db.Exec(`
		UPDATE tokens
		SET key_prefix = substr("key", 1, 12),
			last_four = substr("key", -4)
		WHERE key_version = 0
		  AND "key" <> ''
		  AND key_prefix = ''
		  AND last_four = ''
	`).Error; err != nil {
		return err
	}
	for _, index := range apiKeySecurityIndexes() {
		if err := ensureSQLiteIndex(db, index); err != nil {
			return err
		}
	}
	return nil
}

func validateSQLiteAPIKeySecurity(db *gorm.DB) error {
	if err := validateSQLiteColumns(db, "tokens", apiKeySecurityColumns()); err != nil {
		return err
	}
	return validateSQLiteIndexes(db, apiKeySecurityIndexes())
}

func ensureSQLiteColumns(db *gorm.DB, table string, expected []sqliteColumnExpectation) error {
	actual, err := readSQLiteColumns(db, table)
	if err != nil {
		return err
	}
	for _, column := range expected {
		if current, ok := actual[column.Name]; ok {
			if err := compareSQLiteColumn(table, current, column); err != nil {
				return err
			}
			continue
		}
		statement := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s", quoteSQLiteIdentifier(table), column.Definition)
		if err := db.Exec(statement).Error; err != nil {
			return fmt.Errorf("add SQLite column %s.%s: %w", table, column.Name, err)
		}
	}
	return nil
}

func validateSQLiteColumns(db *gorm.DB, table string, expected []sqliteColumnExpectation) error {
	actual, err := readSQLiteColumns(db, table)
	if err != nil {
		return err
	}
	for _, column := range expected {
		current, ok := actual[column.Name]
		if !ok {
			return fmt.Errorf("SQLite column %s.%s is missing", table, column.Name)
		}
		if err := compareSQLiteColumn(table, current, column); err != nil {
			return err
		}
	}
	return nil
}

func readSQLiteColumns(db *gorm.DB, table string) (map[string]sqliteColumnInfo, error) {
	if !db.Migrator().HasTable(table) {
		return nil, fmt.Errorf("SQLite table %s is missing", table)
	}
	var columns []sqliteColumnInfo
	if err := db.Raw("PRAGMA table_info(" + quoteSQLiteIdentifier(table) + ")").Scan(&columns).Error; err != nil {
		return nil, fmt.Errorf("inspect SQLite table %s: %w", table, err)
	}
	result := make(map[string]sqliteColumnInfo, len(columns))
	for _, column := range columns {
		result[column.Name] = column
	}
	return result, nil
}

func compareSQLiteColumn(table string, actual sqliteColumnInfo, expected sqliteColumnExpectation) error {
	actualType := normalizeSQLiteType(actual.Type)
	expectedType := normalizeSQLiteType(expected.Type)
	if actualType != expectedType {
		return fmt.Errorf(
			"SQLite column %s.%s type mismatch: database=%s expected=%s",
			table,
			expected.Name,
			actualType,
			expectedType,
		)
	}
	if (actual.NotNull != 0) != expected.NotNull {
		return fmt.Errorf(
			"SQLite column %s.%s nullability mismatch",
			table,
			expected.Name,
		)
	}
	actualDefault := ""
	if actual.Default != nil {
		actualDefault = normalizeSQLiteDefault(*actual.Default)
	}
	if actualDefault != normalizeSQLiteDefault(expected.Default) {
		return fmt.Errorf(
			"SQLite column %s.%s default mismatch: database=%q expected=%q",
			table,
			expected.Name,
			actualDefault,
			normalizeSQLiteDefault(expected.Default),
		)
	}
	return nil
}

func normalizeSQLiteType(value string) string {
	declared := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(value), " ", ""))
	switch {
	case strings.Contains(declared, "INT"):
		return "INTEGER"
	case strings.Contains(declared, "CHAR"),
		strings.Contains(declared, "CLOB"),
		strings.Contains(declared, "TEXT"):
		return "TEXT"
	case strings.Contains(declared, "BLOB") || declared == "":
		return "BLOB"
	case strings.Contains(declared, "REAL"),
		strings.Contains(declared, "FLOA"),
		strings.Contains(declared, "DOUB"):
		return "REAL"
	default:
		return "NUMERIC"
	}
}

func normalizeSQLiteDefault(value string) string {
	value = strings.TrimSpace(value)
	for len(value) >= 2 && strings.HasPrefix(value, "(") && strings.HasSuffix(value, ")") {
		value = strings.TrimSpace(value[1 : len(value)-1])
	}
	if len(value) >= 2 && strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`) {
		value = "'" + strings.ReplaceAll(value[1:len(value)-1], "'", "''") + "'"
	}
	value = strings.ToLower(value)
	switch value {
	case "false":
		return "0"
	case "true":
		return "1"
	default:
		return value
	}
}

func ensureSQLiteIndex(db *gorm.DB, expected sqliteIndexExpectation) error {
	exists, err := inspectSQLiteIndex(db, expected)
	if err != nil {
		if expected.Unique &&
			strings.HasSuffix(normalizeSQLiteExpression(expected.Where), " IS NOT NULL") &&
			strings.Contains(err.Error(), "predicate mismatch") {
			if dropErr := db.Exec("DROP INDEX " + quoteSQLiteIdentifier(expected.Name)).Error; dropErr != nil {
				return fmt.Errorf("replace SQLite index %s: %w", expected.Name, dropErr)
			}
			if createErr := db.Exec(expected.Create).Error; createErr != nil {
				return fmt.Errorf("replace SQLite index %s: %w", expected.Name, createErr)
			}
			_, verifyErr := inspectSQLiteIndex(db, expected)
			return verifyErr
		}
		return err
	}
	if exists {
		return nil
	}
	if expected.Create == "" {
		return fmt.Errorf("SQLite index %s is missing", expected.Name)
	}
	if err := db.Exec(expected.Create).Error; err != nil {
		return fmt.Errorf("create SQLite index %s: %w", expected.Name, err)
	}
	_, err = inspectSQLiteIndex(db, expected)
	return err
}

func validateSQLiteIndexes(db *gorm.DB, expected []sqliteIndexExpectation) error {
	for _, index := range expected {
		exists, err := inspectSQLiteIndex(db, index)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("SQLite index %s on %s is missing", index.Name, index.Table)
		}
	}
	return nil
}

func inspectSQLiteIndex(db *gorm.DB, expected sqliteIndexExpectation) (bool, error) {
	var indexes []sqliteIndexInfo
	if err := db.Raw("PRAGMA index_list(" + quoteSQLiteIdentifier(expected.Table) + ")").Scan(&indexes).Error; err != nil {
		return false, fmt.Errorf("inspect SQLite indexes on %s: %w", expected.Table, err)
	}
	var found *sqliteIndexInfo
	for i := range indexes {
		if indexes[i].Name == expected.Name {
			found = &indexes[i]
			break
		}
	}
	if found == nil {
		return false, nil
	}
	if (found.Unique != 0) != expected.Unique {
		return false, fmt.Errorf("SQLite index %s uniqueness mismatch", expected.Name)
	}

	var columns []struct {
		Sequence int    `gorm:"column:seqno"`
		Name     string `gorm:"column:name"`
	}
	if err := db.Raw("PRAGMA index_info(" + quoteSQLiteIdentifier(expected.Name) + ")").Scan(&columns).Error; err != nil {
		return false, fmt.Errorf("inspect SQLite index %s columns: %w", expected.Name, err)
	}
	sort.Slice(columns, func(i, j int) bool {
		return columns[i].Sequence < columns[j].Sequence
	})
	actualColumns := make([]string, 0, len(columns))
	for _, column := range columns {
		actualColumns = append(actualColumns, column.Name)
	}
	if strings.Join(actualColumns, ",") != strings.Join(expected.Columns, ",") {
		return false, fmt.Errorf(
			"SQLite index %s columns mismatch: database=%v expected=%v",
			expected.Name,
			actualColumns,
			expected.Columns,
		)
	}

	var createSQL string
	if err := db.Raw(
		"SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ? AND tbl_name = ?",
		expected.Name,
		expected.Table,
	).Scan(&createSQL).Error; err != nil {
		return false, fmt.Errorf("inspect SQLite index %s SQL: %w", expected.Name, err)
	}
	actualWhere := sqliteIndexWhere(createSQL)
	expectedWhere := normalizeSQLiteExpression(expected.Where)
	if actualWhere != expectedWhere {
		return false, fmt.Errorf(
			"SQLite index %s predicate mismatch: database=%q expected=%q",
			expected.Name,
			actualWhere,
			expectedWhere,
		)
	}
	return true, nil
}

func sqliteIndexWhere(createSQL string) string {
	upper := strings.ToUpper(createSQL)
	position := strings.Index(upper, " WHERE ")
	if position < 0 {
		return ""
	}
	return normalizeSQLiteExpression(createSQL[position+7:])
}

func normalizeSQLiteExpression(value string) string {
	value = strings.ReplaceAll(value, "`", "")
	value = strings.ReplaceAll(value, `"`, "")
	value = whitespacePattern.ReplaceAllString(strings.TrimSpace(value), " ")
	return strings.ToUpper(value)
}

func quoteSQLiteIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
