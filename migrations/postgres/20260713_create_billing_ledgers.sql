CREATE TABLE IF NOT EXISTS billing_ledgers (
    id BIGSERIAL PRIMARY KEY,
    operation_key VARCHAR(128) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    operation VARCHAR(32) NOT NULL,
    funding_source VARCHAR(32) NOT NULL,
    user_id BIGINT NOT NULL,
    token_id BIGINT NOT NULL DEFAULT 0,
    amount BIGINT NOT NULL,
    wallet_before BIGINT NOT NULL,
    wallet_after BIGINT NOT NULL,
    token_remain_before BIGINT NOT NULL DEFAULT 0,
    token_remain_after BIGINT NOT NULL DEFAULT 0,
    token_used_before BIGINT NOT NULL DEFAULT 0,
    token_used_after BIGINT NOT NULL DEFAULT 0,
    token_unlimited BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_ledgers_operation_key
    ON billing_ledgers (operation_key);
CREATE INDEX IF NOT EXISTS idx_billing_ledgers_request_id
    ON billing_ledgers (request_id);
CREATE INDEX IF NOT EXISTS idx_billing_ledgers_operation
    ON billing_ledgers (operation);
CREATE INDEX IF NOT EXISTS idx_billing_ledgers_funding_source
    ON billing_ledgers (funding_source);
CREATE INDEX IF NOT EXISTS idx_billing_ledgers_user_id
    ON billing_ledgers (user_id);
CREATE INDEX IF NOT EXISTS idx_billing_ledgers_token_id
    ON billing_ledgers (token_id);
CREATE INDEX IF NOT EXISTS idx_billing_ledgers_created_at
    ON billing_ledgers (created_at);
