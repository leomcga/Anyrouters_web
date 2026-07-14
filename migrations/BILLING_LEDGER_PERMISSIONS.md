# Billing ledger production permissions

`BillingLedger` rejects GORM `Update`, `Save`, and `Delete` operations through
model hooks. Production database permissions should provide a second layer:

- Run schema migrations with a dedicated migration role.
- Run the application with a role that has `SELECT` and `INSERT` on
  `billing_ledgers`, but no `UPDATE`, `DELETE`, `TRUNCATE`, or `DROP`.
- Keep normal read/write permissions on `billing_requests` and `billing_jobs`;
  these are state-machine tables rather than append-only ledgers.
- Grant ledger repair permissions only to a separately audited break-glass role.

Example PostgreSQL policy after migrations:

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON billing_ledgers FROM anyrouters_app;
GRANT SELECT, INSERT ON billing_ledgers TO anyrouters_app;
GRANT USAGE, SELECT ON SEQUENCE billing_ledgers_id_seq TO anyrouters_app;
```

Example MySQL policy after migrations:

```sql
REVOKE UPDATE, DELETE ON anyrouters.billing_ledgers FROM 'anyrouters_app'@'%';
GRANT SELECT, INSERT ON anyrouters.billing_ledgers TO 'anyrouters_app'@'%';
```

SQLite has no table-level grants. Production SQLite deployments must rely on
the application hooks, filesystem permissions, backups, and an offline
reconciliation procedure. MySQL/PostgreSQL are recommended for multi-instance
commercial deployments.

## Executable operations

The repository includes parameterized scripts that contain no credentials:

```bash
# Print the SQL for review.
DB_ENGINE=mysql DB_NAME=anyrouters APP_DB_USER=anyrouters_app \
  ./ops/configure-billing-ledger-permissions.sh

DB_ENGINE=postgres DB_SCHEMA=public APP_DB_ROLE=anyrouters_app \
  ./ops/configure-billing-ledger-permissions.sh

# Apply with the migration/admin account. Passwords remain in the standard
# MYSQL_PWD / PGPASSWORD environment variables or client credential files.
PERMISSION_MODE=apply DB_ENGINE=mysql DB_NAME=anyrouters \
  APP_DB_USER=anyrouters_app MYSQL_HOST=db MYSQL_USER=migration_admin \
  ./ops/configure-billing-ledger-permissions.sh

PERMISSION_MODE=apply DB_ENGINE=postgres DB_SCHEMA=public \
  APP_DB_ROLE=anyrouters_app PGHOST=db PGUSER=migration_admin \
  PGDATABASE=anyrouters ./ops/configure-billing-ledger-permissions.sh
```

Verify using an account that can read database privilege metadata:

```bash
DB_ENGINE=mysql DB_NAME=anyrouters APP_DB_USER=anyrouters_app \
  MYSQL_HOST=db MYSQL_USER=permission_auditor \
  ./ops/verify-billing-ledger-permissions.sh

DB_ENGINE=postgres DB_SCHEMA=public APP_DB_ROLE=anyrouters_app \
  PGHOST=db PGUSER=permission_auditor PGDATABASE=anyrouters \
  ./ops/verify-billing-ledger-permissions.sh
```

The verifier exits non-zero when `SELECT`/`INSERT` are missing or when the
application identity can obtain `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, or
`ALTER` capability through table, schema/global privilege, direct or inherited
ownership, or superuser access.

For break-glass maintenance, temporarily use a separately audited database
role. Do not grant repair privileges to the application role. Re-run the
verification script immediately after maintenance.
