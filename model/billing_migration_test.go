package model

import (
	"os"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func executeSQLiteMigration(t *testing.T, db *gorm.DB, path string) {
	t.Helper()
	sqlBytes, err := os.ReadFile(path)
	require.NoError(t, err)
	require.NoError(t, db.Exec(string(sqlBytes)).Error)
}

func newSQLiteMigrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	return db
}

func TestSQLiteBillingMigrationsFromEmptyDatabase(t *testing.T) {
	db := newSQLiteMigrationDB(t)
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_create_billing_ledgers.sql")
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_02_create_billing_requests_jobs.sql")
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_03_expand_billing_ledgers.sql")

	assert.True(t, db.Migrator().HasTable(&BillingRequest{}))
	assert.True(t, db.Migrator().HasTable(&BillingLedger{}))
	assert.True(t, db.Migrator().HasTable(&BillingJob{}))
	for _, column := range []string{
		"subscription_id",
		"target_quota",
		"actual_quota",
		"subscription_used_before",
		"subscription_used_after",
		"request_status_before",
		"request_status_after",
	} {
		assert.True(t, db.Migrator().HasColumn(&BillingLedger{}, column), column)
	}
}

func TestSQLiteBillingMigrationsPreserveExistingLedgerRows(t *testing.T) {
	db := newSQLiteMigrationDB(t)
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_create_billing_ledgers.sql")
	require.NoError(t, db.Exec(`
		INSERT INTO billing_ledgers (
			operation_key, request_id, operation, funding_source, user_id, token_id,
			amount, wallet_before, wallet_after, token_remain_before,
			token_remain_after, token_used_before, token_used_after,
			token_unlimited, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, "legacy:reserve", "legacy", "reserve", "wallet", 1, 2, 10, 100, 90, 100, 90, 0, 10, false, 1).Error)

	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_02_create_billing_requests_jobs.sql")
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_03_expand_billing_ledgers.sql")

	var count int64
	require.NoError(t, db.Table("billing_ledgers").Where("operation_key = ?", "legacy:reserve").Count(&count).Error)
	assert.EqualValues(t, 1, count)

	var migrated struct {
		SubscriptionId      int64
		TargetQuota         int64
		ActualQuota         int64
		RequestStatusBefore string
		RequestStatusAfter  string
	}
	require.NoError(t, db.Table("billing_ledgers").
		Where("operation_key = ?", "legacy:reserve").
		First(&migrated).Error)
	assert.Zero(t, migrated.SubscriptionId)
	assert.Zero(t, migrated.TargetQuota)
	assert.Zero(t, migrated.ActualQuota)
	assert.Empty(t, migrated.RequestStatusBefore)
	assert.Empty(t, migrated.RequestStatusAfter)
}

func createLegacyAsyncTaskTables(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.Exec(`
		CREATE TABLE tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			task_id VARCHAR(191) NOT NULL,
			user_id INTEGER NOT NULL,
			status VARCHAR(20) NOT NULL,
			progress VARCHAR(20) NOT NULL
		);
		CREATE TABLE midjourneys (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			mj_id VARCHAR(191) NOT NULL,
			user_id INTEGER NOT NULL,
			status VARCHAR(20) NOT NULL,
			progress VARCHAR(30) NOT NULL
		);
		CREATE TABLE sandbox_daily_usage (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			day VARCHAR(8) NOT NULL,
			count INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			UNIQUE(user_id, day)
		);
	`).Error)
}

func TestSQLiteAsyncTaskBillingMigrationFromEmptyBaseSchema(t *testing.T) {
	db := newSQLiteMigrationDB(t)
	createLegacyAsyncTaskTables(t, db)
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_04_async_task_billing_state.sql")

	for _, column := range []string{
		"request_id",
		"billing_request_id",
		"upstream_status",
		"billing_status",
		"final_quota",
		"version",
		"locked_until",
	} {
		assert.True(t, db.Migrator().HasColumn("tasks", column), column)
		assert.True(t, db.Migrator().HasColumn("midjourneys", column), column)
	}
	assert.True(t, db.Migrator().HasTable("sandbox_executions"))
}

func TestSQLiteAsyncTaskBillingMigrationPreservesExistingTasks(t *testing.T) {
	db := newSQLiteMigrationDB(t)
	createLegacyAsyncTaskTables(t, db)
	require.NoError(t, db.Exec(
		"INSERT INTO tasks (task_id, user_id, status, progress) VALUES (?, ?, ?, ?)",
		"legacy-task", 1, "IN_PROGRESS", "50%",
	).Error)
	require.NoError(t, db.Exec(
		"INSERT INTO midjourneys (mj_id, user_id, status, progress) VALUES (?, ?, ?, ?)",
		"legacy-mj", 1, "", "25%",
	).Error)

	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_04_async_task_billing_state.sql")

	var taskCount int64
	require.NoError(t, db.Table("tasks").Where("task_id = ?", "legacy-task").Count(&taskCount).Error)
	assert.EqualValues(t, 1, taskCount)
	var midjourneyCount int64
	require.NoError(t, db.Table("midjourneys").Where("mj_id = ?", "legacy-mj").Count(&midjourneyCount).Error)
	assert.EqualValues(t, 1, midjourneyCount)
}

func TestSQLiteStripePaymentMigrationFromEmptyDatabase(t *testing.T) {
	db := newSQLiteMigrationDB(t)
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_05_stripe_payment_safety.sql")
	for _, table := range []string{
		"stripe_payment_orders",
		"stripe_webhook_events",
		"payment_credit_ledgers",
		"payment_audits",
	} {
		assert.True(t, db.Migrator().HasTable(table), table)
	}
	for _, column := range []string{
		"attempts",
		"max_attempts",
		"next_retry_at",
		"locked_by",
		"locked_until",
		"checkout_url",
		"last_stripe_event_id",
	} {
		assert.True(t, db.Migrator().HasColumn("stripe_payment_orders", column), column)
	}
}

func TestSQLiteStripePaymentMigrationPreservesLegacyOrdersAndIsRepeatable(t *testing.T) {
	db := newSQLiteMigrationDB(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE top_ups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			trade_no TEXT NOT NULL,
			money REAL NOT NULL
		);
		CREATE TABLE subscription_orders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			trade_no TEXT NOT NULL,
			money REAL NOT NULL
		);
		INSERT INTO top_ups (trade_no, money) VALUES ('legacy-topup', 10.5);
		INSERT INTO subscription_orders (trade_no, money) VALUES ('legacy-subscription', 20.5);
	`).Error)
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_05_stripe_payment_safety.sql")
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_05_stripe_payment_safety.sql")

	var topUpCount, subscriptionCount int64
	require.NoError(t, db.Table("top_ups").Where("trade_no = ?", "legacy-topup").Count(&topUpCount).Error)
	require.NoError(t, db.Table("subscription_orders").Where("trade_no = ?", "legacy-subscription").Count(&subscriptionCount).Error)
	assert.EqualValues(t, 1, topUpCount)
	assert.EqualValues(t, 1, subscriptionCount)
}

func TestSQLiteStripePaymentUniqueIndexesAllowEmptyBindings(t *testing.T) {
	db := newSQLiteMigrationDB(t)
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_05_stripe_payment_safety.sql")
	base := StripePaymentOrder{
		OrderKind:           StripeOrderKindTopUp,
		UserId:              1,
		Status:              StripeOrderStatusCreated,
		ExpectedAmountMinor: 100,
		Currency:            "usd",
		CreditedQuota:       10,
		PriceConfigVersion:  "v1",
		PriceSnapshot:       `{}`,
		CheckoutSuccessUrl:  "https://example.com/success",
		CheckoutCancelUrl:   "https://example.com/cancel",
	}
	first := base
	first.OrderNo = "sp_migration_1"
	first.IdempotencyKey = "stripe:checkout:sp_migration_1"
	second := base
	second.OrderNo = "sp_migration_2"
	second.IdempotencyKey = "stripe:checkout:sp_migration_2"
	require.NoError(t, db.Create(&first).Error)
	require.NoError(t, db.Create(&second).Error)

	require.NoError(t, db.Model(&StripePaymentOrder{}).Where("id = ?", first.Id).
		Update("stripe_checkout_session_id", "cs_unique").Error)
	err := db.Model(&StripePaymentOrder{}).Where("id = ?", second.Id).
		Update("stripe_checkout_session_id", "cs_unique").Error
	require.Error(t, err)
}

func TestSQLiteStripePaymentSchemaVerificationAndUniqueConstraints(t *testing.T) {
	db := newSQLiteMigrationDB(t)
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_05_stripe_payment_safety.sql")
	require.NoError(t, VerifyStripePaymentSchema(db))

	baseOrder := map[string]interface{}{
		"order_kind":            StripeOrderKindTopUp,
		"user_id":               1,
		"status":                StripeOrderStatusCreated,
		"expected_amount_minor": 100,
		"currency":              "usd",
		"credited_quota":        10,
		"checkout_success_url":  "https://example.com/success",
		"checkout_cancel_url":   "https://example.com/cancel",
		"checkout_url":          "",
		"livemode":              false,
		"price_config_version":  "v1",
		"price_snapshot":        "{}",
		"last_error":            "",
		"created_at":            1,
		"updated_at":            1,
	}
	insertOrder := func(orderNo, sessionID, paymentIntentID string) error {
		values := make(map[string]interface{}, len(baseOrder)+4)
		for key, value := range baseOrder {
			values[key] = value
		}
		values["order_no"] = orderNo
		values["idempotency_key"] = "stripe:checkout:" + orderNo
		values["stripe_checkout_session_id"] = sessionID
		values["stripe_payment_intent_id"] = paymentIntentID
		return db.Table("stripe_payment_orders").Create(values).Error
	}
	require.NoError(t, insertOrder("sp_schema_1", "cs_schema", "pi_schema"))
	require.Error(t, insertOrder("sp_schema_1", "cs_order_other", "pi_order_other"))
	require.Error(t, insertOrder("sp_schema_2", "cs_schema", "pi_other"))
	require.Error(t, insertOrder("sp_schema_3", "cs_other", "pi_schema"))

	event := map[string]interface{}{
		"stripe_event_id": "evt_schema", "event_type": "customer.created", "api_version": "test",
		"livemode": false, "status": StripeEventStatusReceived, "payload_digest": strings.Repeat("a", 64),
		"last_error": "", "received_at": 1, "created_at": 1, "updated_at": 1,
	}
	require.NoError(t, db.Table("stripe_webhook_events").Create(event).Error)
	event["id"] = nil
	require.Error(t, db.Table("stripe_webhook_events").Create(event).Error)

	ledger := map[string]interface{}{
		"operation_key": "stripe:credit:sp_schema_1", "order_no": "sp_schema_1",
		"stripe_event_id": "evt_schema", "user_id": 1, "order_kind": StripeOrderKindTopUp,
		"amount_minor": 100, "currency": "usd", "credited_quota": 10,
		"wallet_before": 0, "wallet_after": 10, "created_at": 1,
	}
	require.NoError(t, db.Table("payment_credit_ledgers").Create(ledger).Error)
	delete(ledger, "id")
	ledger["order_no"] = "sp_schema_other"
	require.Error(t, db.Table("payment_credit_ledgers").Create(ledger).Error)
	ledger["operation_key"] = "stripe:credit:sp_schema_other"
	ledger["order_no"] = "sp_schema_1"
	require.Error(t, db.Table("payment_credit_ledgers").Create(ledger).Error)
}

func TestSQLiteStripePaymentSchemaVerificationFailsClosed(t *testing.T) {
	db := newSQLiteMigrationDB(t)
	executeSQLiteMigration(t, db, "../migrations/sqlite/20260713_05_stripe_payment_safety.sql")
	require.NoError(t, db.Exec("DROP INDEX idx_payment_credit_ledgers_order_no").Error)
	require.Error(t, VerifyStripePaymentSchema(db))
}
