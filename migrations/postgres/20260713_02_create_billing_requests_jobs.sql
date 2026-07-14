CREATE TABLE IF NOT EXISTS billing_requests (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    funding_source VARCHAR(32) NOT NULL,
    user_id BIGINT NOT NULL,
    token_id BIGINT NOT NULL DEFAULT 0,
    subscription_id BIGINT NOT NULL DEFAULT 0,
    token_unlimited BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL,
    reserved_quota BIGINT NOT NULL DEFAULT 0,
    actual_quota BIGINT NOT NULL DEFAULT 0,
    refunded_quota BIGINT NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_requests_request_id ON billing_requests (request_id);
CREATE INDEX IF NOT EXISTS idx_billing_requests_funding_source ON billing_requests (funding_source);
CREATE INDEX IF NOT EXISTS idx_billing_requests_user_id ON billing_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_billing_requests_token_id ON billing_requests (token_id);
CREATE INDEX IF NOT EXISTS idx_billing_requests_subscription_id ON billing_requests (subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_requests_status ON billing_requests (status);
CREATE INDEX IF NOT EXISTS idx_billing_requests_updated_at ON billing_requests (updated_at);

CREATE TABLE IF NOT EXISTS billing_jobs (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    operation_key VARCHAR(128) NOT NULL,
    operation_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    target_quota BIGINT NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 10,
    next_retry_at BIGINT NOT NULL DEFAULT 0,
    locked_by VARCHAR(128) NOT NULL DEFAULT '',
    locked_until BIGINT NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    completed_at BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_jobs_operation_key ON billing_jobs (operation_key);
CREATE INDEX IF NOT EXISTS idx_billing_jobs_request_id ON billing_jobs (request_id);
CREATE INDEX IF NOT EXISTS idx_billing_jobs_operation_type ON billing_jobs (operation_type);
CREATE INDEX IF NOT EXISTS idx_billing_jobs_scan ON billing_jobs (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_billing_jobs_locked_until ON billing_jobs (locked_until);
