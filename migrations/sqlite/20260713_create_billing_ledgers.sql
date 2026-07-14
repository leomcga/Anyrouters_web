CREATE TABLE IF NOT EXISTS billing_ledgers (
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
