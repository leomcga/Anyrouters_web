CREATE TABLE IF NOT EXISTS stripe_payment_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL,
  order_kind TEXT NOT NULL,
  legacy_top_up_id INTEGER NOT NULL DEFAULT 0,
  legacy_subscription_order INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'stripe',
  status TEXT NOT NULL,
  expected_amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  credited_quota INTEGER NOT NULL DEFAULT 0,
  stripe_checkout_session_id TEXT NOT NULL DEFAULT '',
  stripe_payment_intent_id TEXT NOT NULL DEFAULT '',
  stripe_customer_id TEXT NOT NULL DEFAULT '',
  checkout_customer_email TEXT NOT NULL DEFAULT '',
  stripe_price_id TEXT NOT NULL DEFAULT '',
  checkout_success_url TEXT NOT NULL,
  checkout_cancel_url TEXT NOT NULL,
  checkout_url TEXT NOT NULL,
  last_stripe_event_id TEXT NOT NULL DEFAULT '',
  livemode INTEGER NOT NULL DEFAULT 0,
  price_config_version TEXT NOT NULL,
  price_snapshot TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  paid_at INTEGER NOT NULL DEFAULT 0,
  credited_at INTEGER NOT NULL DEFAULT 0,
  failed_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 12,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT NOT NULL DEFAULT '',
  locked_until INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  api_version TEXT NOT NULL,
  livemode INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 12,
  order_no TEXT NOT NULL DEFAULT '',
  stripe_object_id TEXT NOT NULL DEFAULT '',
  checkout_session_id TEXT NOT NULL DEFAULT '',
  payment_intent_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT '',
  payload_digest TEXT NOT NULL,
  last_error TEXT NOT NULL,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT NOT NULL DEFAULT '',
  locked_until INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  processed_at INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_id ON stripe_webhook_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_order_no ON stripe_webhook_events(order_no);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_scan ON stripe_webhook_events(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_locked_until ON stripe_webhook_events(locked_until);

CREATE TABLE IF NOT EXISTS payment_credit_ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL,
  order_no TEXT NOT NULL,
  stripe_event_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  order_kind TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  credited_quota INTEGER NOT NULL DEFAULT 0,
  wallet_before INTEGER NOT NULL,
  wallet_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_credit_ledgers_operation_key ON payment_credit_ledgers(operation_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_credit_ledgers_order_no ON payment_credit_ledgers(order_no);
CREATE INDEX IF NOT EXISTS idx_payment_credit_ledgers_event_id ON payment_credit_ledgers(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_credit_ledgers_user_id ON payment_credit_ledgers(user_id);

CREATE TABLE IF NOT EXISTS payment_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL,
  stripe_event_id TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL,
  actor_id INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status_before TEXT NOT NULL DEFAULT '',
  status_after TEXT NOT NULL DEFAULT '',
  stripe_object_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_audits_order_no ON payment_audits(order_no);
CREATE INDEX IF NOT EXISTS idx_payment_audits_event_id ON payment_audits(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_audits_created_at ON payment_audits(created_at);
