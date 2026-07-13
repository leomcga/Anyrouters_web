ALTER TABLE billing_ledgers ADD COLUMN subscription_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN target_quota INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN actual_quota INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN subscription_used_before INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN subscription_used_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN request_status_before VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE billing_ledgers ADD COLUMN request_status_after VARCHAR(32) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_billing_ledgers_subscription_id ON billing_ledgers (subscription_id);
