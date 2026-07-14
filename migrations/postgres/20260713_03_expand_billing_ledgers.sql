ALTER TABLE billing_ledgers ADD COLUMN IF NOT EXISTS subscription_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN IF NOT EXISTS target_quota BIGINT NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN IF NOT EXISTS actual_quota BIGINT NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN IF NOT EXISTS subscription_used_before BIGINT NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN IF NOT EXISTS subscription_used_after BIGINT NOT NULL DEFAULT 0;
ALTER TABLE billing_ledgers ADD COLUMN IF NOT EXISTS request_status_before VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE billing_ledgers ADD COLUMN IF NOT EXISTS request_status_after VARCHAR(32) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_billing_ledgers_subscription_id ON billing_ledgers (subscription_id);
