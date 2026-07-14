CREATE TABLE IF NOT EXISTS stripe_payment_orders (
  id BIGSERIAL PRIMARY KEY,
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
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 12,
  next_retry_at BIGINT NOT NULL DEFAULT 0,
  locked_by VARCHAR(128) NOT NULL DEFAULT '',
  locked_until BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_payment_orders_order_no ON stripe_payment_orders(order_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_payment_orders_idempotency ON stripe_payment_orders(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_payment_orders_session_unique
  ON stripe_payment_orders(stripe_checkout_session_id) WHERE stripe_checkout_session_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_payment_orders_intent_unique
  ON stripe_payment_orders(stripe_payment_intent_id) WHERE stripe_payment_intent_id <> '';
CREATE INDEX IF NOT EXISTS idx_stripe_payment_orders_user_id ON stripe_payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_payment_orders_scan ON stripe_payment_orders(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_stripe_payment_orders_locked_until ON stripe_payment_orders(locked_until);
CREATE INDEX IF NOT EXISTS idx_stripe_payment_orders_last_event ON stripe_payment_orders(last_stripe_event_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  stripe_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  api_version VARCHAR(64) NOT NULL,
  livemode BOOLEAN NOT NULL,
  status VARCHAR(32) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 12,
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
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_id ON stripe_webhook_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_order_no ON stripe_webhook_events(order_no);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_scan ON stripe_webhook_events(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_locked_until ON stripe_webhook_events(locked_until);

CREATE TABLE IF NOT EXISTS payment_credit_ledgers (
  id BIGSERIAL PRIMARY KEY,
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
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_credit_ledgers_operation_key ON payment_credit_ledgers(operation_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_credit_ledgers_order_no ON payment_credit_ledgers(order_no);
CREATE INDEX IF NOT EXISTS idx_payment_credit_ledgers_event_id ON payment_credit_ledgers(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_credit_ledgers_user_id ON payment_credit_ledgers(user_id);

CREATE TABLE IF NOT EXISTS payment_audits (
  id BIGSERIAL PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL,
  stripe_event_id VARCHAR(255) NOT NULL DEFAULT '',
  actor_type VARCHAR(32) NOT NULL,
  actor_id BIGINT NOT NULL DEFAULT 0,
  action VARCHAR(64) NOT NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  status_before VARCHAR(32) NOT NULL DEFAULT '',
  status_after VARCHAR(32) NOT NULL DEFAULT '',
  stripe_object_id VARCHAR(255) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_audits_order_no ON payment_audits(order_no);
CREATE INDEX IF NOT EXISTS idx_payment_audits_event_id ON payment_audits(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_audits_created_at ON payment_audits(created_at);
