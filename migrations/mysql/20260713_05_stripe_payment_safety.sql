CREATE TABLE IF NOT EXISTS stripe_payment_orders (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL,
  order_kind VARCHAR(32) NOT NULL,
  legacy_top_up_id BIGINT NOT NULL DEFAULT 0,
  legacy_subscription_order BIGINT NOT NULL DEFAULT 0,
  user_id BIGINT NOT NULL,
  plan_id BIGINT NOT NULL DEFAULT 0,
  provider VARCHAR(32) NOT NULL DEFAULT 'stripe',
  status VARCHAR(32) NOT NULL,
  expected_amount_minor BIGINT NOT NULL,
  currency VARCHAR(8) NOT NULL,
  credited_quota BIGINT NOT NULL DEFAULT 0,
  stripe_checkout_session_id VARCHAR(255) NOT NULL DEFAULT '',
  stripe_payment_intent_id VARCHAR(255) NOT NULL DEFAULT '',
  stripe_customer_id VARCHAR(255) NOT NULL DEFAULT '',
  checkout_customer_email VARCHAR(255) NOT NULL DEFAULT '',
  stripe_price_id VARCHAR(255) NOT NULL DEFAULT '',
  checkout_success_url TEXT NOT NULL,
  checkout_cancel_url TEXT NOT NULL,
  checkout_url TEXT NOT NULL,
  last_stripe_event_id VARCHAR(255) NOT NULL DEFAULT '',
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  price_config_version VARCHAR(128) NOT NULL,
  price_snapshot TEXT NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  paid_at BIGINT NOT NULL DEFAULT 0,
  credited_at BIGINT NOT NULL DEFAULT 0,
  failed_at BIGINT NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 12,
  next_retry_at BIGINT NOT NULL DEFAULT 0,
  locked_by VARCHAR(128) NOT NULL DEFAULT '',
  locked_until BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  stripe_checkout_session_unique VARCHAR(255)
    GENERATED ALWAYS AS (NULLIF(stripe_checkout_session_id, '')) STORED,
  stripe_payment_intent_unique VARCHAR(255)
    GENERATED ALWAYS AS (NULLIF(stripe_payment_intent_id, '')) STORED,
  UNIQUE KEY idx_stripe_payment_orders_order_no (order_no),
  UNIQUE KEY idx_stripe_payment_orders_idempotency (idempotency_key),
  UNIQUE KEY idx_stripe_payment_orders_session_unique (stripe_checkout_session_unique),
  UNIQUE KEY idx_stripe_payment_orders_intent_unique (stripe_payment_intent_unique),
  KEY idx_stripe_payment_orders_user_id (user_id),
  KEY idx_stripe_payment_orders_scan (status, next_retry_at),
  KEY idx_stripe_payment_orders_locked_until (locked_until),
  KEY idx_stripe_payment_orders_last_event (last_stripe_event_id)
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  stripe_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  api_version VARCHAR(64) NOT NULL,
  livemode BOOLEAN NOT NULL,
  status VARCHAR(32) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 12,
  order_no VARCHAR(64) NOT NULL DEFAULT '',
  stripe_object_id VARCHAR(255) NOT NULL DEFAULT '',
  checkout_session_id VARCHAR(255) NOT NULL DEFAULT '',
  payment_intent_id VARCHAR(255) NOT NULL DEFAULT '',
  customer_id VARCHAR(255) NOT NULL DEFAULT '',
  amount_minor BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT '',
  payment_status VARCHAR(32) NOT NULL DEFAULT '',
  payload_digest VARCHAR(64) NOT NULL,
  last_error TEXT NOT NULL,
  next_retry_at BIGINT NOT NULL DEFAULT 0,
  locked_by VARCHAR(128) NOT NULL DEFAULT '',
  locked_until BIGINT NOT NULL DEFAULT 0,
  received_at BIGINT NOT NULL,
  processed_at BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY idx_stripe_webhook_events_event_id (stripe_event_id),
  KEY idx_stripe_webhook_events_order_no (order_no),
  KEY idx_stripe_webhook_events_scan (status, next_retry_at),
  KEY idx_stripe_webhook_events_locked_until (locked_until)
);

CREATE TABLE IF NOT EXISTS payment_credit_ledgers (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operation_key VARCHAR(128) NOT NULL,
  order_no VARCHAR(64) NOT NULL,
  stripe_event_id VARCHAR(255) NOT NULL,
  user_id BIGINT NOT NULL,
  order_kind VARCHAR(32) NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency VARCHAR(8) NOT NULL,
  credited_quota BIGINT NOT NULL DEFAULT 0,
  wallet_before BIGINT NOT NULL,
  wallet_after BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY idx_payment_credit_ledgers_operation_key (operation_key),
  UNIQUE KEY idx_payment_credit_ledgers_order_no (order_no),
  KEY idx_payment_credit_ledgers_event_id (stripe_event_id),
  KEY idx_payment_credit_ledgers_user_id (user_id)
);

CREATE TABLE IF NOT EXISTS payment_audits (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL,
  stripe_event_id VARCHAR(255) NOT NULL DEFAULT '',
  actor_type VARCHAR(32) NOT NULL,
  actor_id BIGINT NOT NULL DEFAULT 0,
  action VARCHAR(64) NOT NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  status_before VARCHAR(32) NOT NULL DEFAULT '',
  status_after VARCHAR(32) NOT NULL DEFAULT '',
  stripe_object_id VARCHAR(255) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  KEY idx_payment_audits_order_no (order_no),
  KEY idx_payment_audits_event_id (stripe_event_id),
  KEY idx_payment_audits_created_at (created_at)
);

-- CREATE TABLE IF NOT EXISTS does not repair an older AutoMigrate-created
-- table. Add generated columns and critical unique indexes conditionally so
-- this incremental migration is safe to execute more than once.
SET @stripe_schema_stmt = IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'stripe_payment_orders'
      AND column_name = 'stripe_checkout_session_unique'
  ),
  'SELECT 1',
  'ALTER TABLE stripe_payment_orders ADD COLUMN stripe_checkout_session_unique VARCHAR(255) GENERATED ALWAYS AS (NULLIF(stripe_checkout_session_id, '''')) STORED'
);
PREPARE stripe_schema_statement FROM @stripe_schema_stmt;
EXECUTE stripe_schema_statement;
DEALLOCATE PREPARE stripe_schema_statement;

SET @stripe_schema_stmt = IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'stripe_payment_orders'
      AND column_name = 'stripe_payment_intent_unique'
  ),
  'SELECT 1',
  'ALTER TABLE stripe_payment_orders ADD COLUMN stripe_payment_intent_unique VARCHAR(255) GENERATED ALWAYS AS (NULLIF(stripe_payment_intent_id, '''')) STORED'
);
PREPARE stripe_schema_statement FROM @stripe_schema_stmt;
EXECUTE stripe_schema_statement;
DEALLOCATE PREPARE stripe_schema_statement;

SET @stripe_schema_stmt = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'stripe_payment_orders'
      AND index_name = 'idx_stripe_payment_orders_order_no'
      AND non_unique = 0
  ),
  'SELECT 1',
  'ALTER TABLE stripe_payment_orders ADD UNIQUE INDEX idx_stripe_payment_orders_order_no (order_no)'
);
PREPARE stripe_schema_statement FROM @stripe_schema_stmt;
EXECUTE stripe_schema_statement;
DEALLOCATE PREPARE stripe_schema_statement;

SET @stripe_schema_stmt = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'stripe_payment_orders'
      AND index_name = 'idx_stripe_payment_orders_session_unique'
      AND non_unique = 0
  ),
  'SELECT 1',
  'ALTER TABLE stripe_payment_orders ADD UNIQUE INDEX idx_stripe_payment_orders_session_unique (stripe_checkout_session_unique)'
);
PREPARE stripe_schema_statement FROM @stripe_schema_stmt;
EXECUTE stripe_schema_statement;
DEALLOCATE PREPARE stripe_schema_statement;

SET @stripe_schema_stmt = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'stripe_payment_orders'
      AND index_name = 'idx_stripe_payment_orders_intent_unique'
      AND non_unique = 0
  ),
  'SELECT 1',
  'ALTER TABLE stripe_payment_orders ADD UNIQUE INDEX idx_stripe_payment_orders_intent_unique (stripe_payment_intent_unique)'
);
PREPARE stripe_schema_statement FROM @stripe_schema_stmt;
EXECUTE stripe_schema_statement;
DEALLOCATE PREPARE stripe_schema_statement;

SET @stripe_schema_stmt = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'stripe_webhook_events'
      AND index_name = 'idx_stripe_webhook_events_event_id'
      AND non_unique = 0
  ),
  'SELECT 1',
  'ALTER TABLE stripe_webhook_events ADD UNIQUE INDEX idx_stripe_webhook_events_event_id (stripe_event_id)'
);
PREPARE stripe_schema_statement FROM @stripe_schema_stmt;
EXECUTE stripe_schema_statement;
DEALLOCATE PREPARE stripe_schema_statement;

SET @stripe_schema_stmt = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'payment_credit_ledgers'
      AND index_name = 'idx_payment_credit_ledgers_operation_key'
      AND non_unique = 0
  ),
  'SELECT 1',
  'ALTER TABLE payment_credit_ledgers ADD UNIQUE INDEX idx_payment_credit_ledgers_operation_key (operation_key)'
);
PREPARE stripe_schema_statement FROM @stripe_schema_stmt;
EXECUTE stripe_schema_statement;
DEALLOCATE PREPARE stripe_schema_statement;

SET @stripe_schema_stmt = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'payment_credit_ledgers'
      AND index_name = 'idx_payment_credit_ledgers_order_no'
      AND non_unique = 0
  ),
  'SELECT 1',
  'ALTER TABLE payment_credit_ledgers ADD UNIQUE INDEX idx_payment_credit_ledgers_order_no (order_no)'
);
PREPARE stripe_schema_statement FROM @stripe_schema_stmt;
EXECUTE stripe_schema_statement;
DEALLOCATE PREPARE stripe_schema_statement;
