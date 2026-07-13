ALTER TABLE tasks ADD COLUMN request_id VARCHAR(64);
ALTER TABLE tasks ADD COLUMN billing_request_id INTEGER;
ALTER TABLE tasks ADD COLUMN upstream_task_id VARCHAR(191) NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN submit_attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN upstream_status VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN billing_status VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN upstream_result_persisted NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN price_snapshot_persisted NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN usage_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN usage_available NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN usage_estimated NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN usage_basis VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN usage_wait_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN final_quota INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN final_quota_determined NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN billing_last_error TEXT;
ALTER TABLE tasks ADD COLUMN usage_accounted NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN locked_by VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_request_id ON tasks (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_billing_request_id ON tasks (billing_request_id) WHERE billing_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_upstream_task_id ON tasks (upstream_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_upstream_billing ON tasks (upstream_status, billing_status);
CREATE INDEX IF NOT EXISTS idx_tasks_usage_wait_until ON tasks (usage_wait_until);
CREATE INDEX IF NOT EXISTS idx_tasks_locked_until ON tasks (locked_until);

ALTER TABLE midjourneys ADD COLUMN request_id VARCHAR(64);
ALTER TABLE midjourneys ADD COLUMN billing_request_id INTEGER;
ALTER TABLE midjourneys ADD COLUMN upstream_status VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE midjourneys ADD COLUMN billing_status VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE midjourneys ADD COLUMN upstream_result_persisted NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE midjourneys ADD COLUMN price_snapshot_persisted NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE midjourneys ADD COLUMN billing_snapshot TEXT;
ALTER TABLE midjourneys ADD COLUMN submit_attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE midjourneys ADD COLUMN final_quota INTEGER NOT NULL DEFAULT 0;
ALTER TABLE midjourneys ADD COLUMN final_quota_determined NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE midjourneys ADD COLUMN billing_last_error TEXT;
ALTER TABLE midjourneys ADD COLUMN usage_accounted NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE midjourneys ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE midjourneys ADD COLUMN locked_by VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE midjourneys ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_midjourneys_request_id ON midjourneys (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_midjourneys_billing_request_id ON midjourneys (billing_request_id) WHERE billing_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_midjourneys_upstream_billing ON midjourneys (upstream_status, billing_status);
CREATE INDEX IF NOT EXISTS idx_midjourneys_locked_until ON midjourneys (locked_until);

CREATE TABLE IF NOT EXISTS sandbox_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id VARCHAR(64) NOT NULL,
    user_id INTEGER NOT NULL,
    day VARCHAR(8) NOT NULL,
    ordinal INTEGER NOT NULL,
    is_free NUMERIC NOT NULL,
    quota INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sandbox_executions_request_id ON sandbox_executions (request_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_executions_user_day ON sandbox_executions (user_id, day);
CREATE INDEX IF NOT EXISTS idx_sandbox_executions_status_created ON sandbox_executions (status, created_at);
