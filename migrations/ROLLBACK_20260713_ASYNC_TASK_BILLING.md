# Async task billing rollback

Stop task pollers before rollback. Do not delete `billing_requests`, `billing_ledgers`,
or `billing_jobs`; they are the financial source of truth.

MySQL can drop the `idx_*` indexes and the columns added by
`20260713_04_async_task_billing_state.sql` with `ALTER TABLE`.

PostgreSQL can use `DROP INDEX IF EXISTS` followed by `ALTER TABLE ... DROP
COLUMN IF EXISTS` for the same columns.

SQLite requires rebuilding `tasks` and `midjourneys` without the added columns.
Take a database backup first. A rollback removes task-to-ledger recovery metadata,
so it must only be used after traffic is stopped and all pending billing jobs are
resolved or exported for manual reconciliation.
