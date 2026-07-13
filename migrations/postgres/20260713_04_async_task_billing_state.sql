ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS request_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS billing_request_id BIGINT,
    ADD COLUMN IF NOT EXISTS upstream_task_id VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS submit_attempt INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS upstream_status VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS billing_status VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS upstream_result_persisted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS price_snapshot_persisted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS billing_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS usage_total BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS usage_available BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS usage_estimated BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS usage_basis VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS usage_wait_until BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS final_quota BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS final_quota_determined BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS billing_last_error TEXT,
    ADD COLUMN IF NOT EXISTS usage_accounted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS locked_by VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS locked_until BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_request_id ON tasks (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_billing_request_id ON tasks (billing_request_id) WHERE billing_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_upstream_task_id ON tasks (upstream_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_upstream_billing ON tasks (upstream_status, billing_status);
CREATE INDEX IF NOT EXISTS idx_tasks_usage_wait_until ON tasks (usage_wait_until);
CREATE INDEX IF NOT EXISTS idx_tasks_locked_until ON tasks (locked_until);

ALTER TABLE midjourneys
    ADD COLUMN IF NOT EXISTS request_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS billing_request_id BIGINT,
    ADD COLUMN IF NOT EXISTS upstream_status VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS billing_status VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS upstream_result_persisted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS price_snapshot_persisted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS final_quota BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS final_quota_determined BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS billing_last_error TEXT,
    ADD COLUMN IF NOT EXISTS usage_accounted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS locked_by VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS locked_until BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_midjourneys_request_id ON midjourneys (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_midjourneys_billing_request_id ON midjourneys (billing_request_id) WHERE billing_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_midjourneys_upstream_billing ON midjourneys (upstream_status, billing_status);
CREATE INDEX IF NOT EXISTS idx_midjourneys_locked_until ON midjourneys (locked_until);

CREATE TABLE IF NOT EXISTS sandbox_executions (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    user_id BIGINT NOT NULL,
    day VARCHAR(8) NOT NULL,
    ordinal INTEGER NOT NULL,
    is_free BOOLEAN NOT NULL,
    quota BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sandbox_executions_request_id ON sandbox_executions (request_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_executions_user_day ON sandbox_executions (user_id, day);
CREATE INDEX IF NOT EXISTS idx_sandbox_executions_status_created ON sandbox_executions (status, created_at);
