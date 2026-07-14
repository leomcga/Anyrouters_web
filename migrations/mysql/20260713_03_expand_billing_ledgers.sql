ALTER TABLE billing_ledgers
    ADD COLUMN subscription_id BIGINT NOT NULL DEFAULT 0 AFTER token_id,
    ADD COLUMN target_quota BIGINT NOT NULL DEFAULT 0 AFTER amount,
    ADD COLUMN actual_quota BIGINT NOT NULL DEFAULT 0 AFTER target_quota,
    ADD COLUMN subscription_used_before BIGINT NOT NULL DEFAULT 0 AFTER token_unlimited,
    ADD COLUMN subscription_used_after BIGINT NOT NULL DEFAULT 0 AFTER subscription_used_before,
    ADD COLUMN request_status_before VARCHAR(32) NOT NULL DEFAULT '' AFTER subscription_used_after,
    ADD COLUMN request_status_after VARCHAR(32) NOT NULL DEFAULT '' AFTER request_status_before,
    ADD KEY idx_billing_ledgers_subscription_id (subscription_id);
