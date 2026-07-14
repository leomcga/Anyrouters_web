# Production operations

Run the production readiness check before every deployment:

```bash
./ops/verify-production-readiness.sh
```

The check fails closed when:

- the local commit is not clean and synchronized with `origin/main`;
- Cloud SQL is unavailable, lacks deletion protection, or has no recent successful backup;
- Cloud Run has no ready revision serving 100% traffic.

To run the checked build and deployment flow:

```bash
./ops/deploy-production.sh redesignN
```

The scripts contain no credentials. Authentication continues to use the active
`gcloud` account and the existing Secret Manager references.

The production service must set:

```bash
APP_ENV=production
DEBUG=false
SESSION_SECRET=<Secret Manager reference, at least 32 random characters>
CORS_ALLOWED_ORIGINS=https://anyrouters.com
```

If `DEBUG=true` is supplied while `APP_ENV` is `production` (or `prod`), the
application forces debug logging off and emits a credential-free warning.

## Browser and session security

Run `./ops/verify-web-security-readiness.sh` before deployment. Credentialed
CORS is restricted to exact HTTPS origins from `CORS_ALLOWED_ORIGINS`; wildcard
origins are rejected. Same-origin deployments may leave the list empty.

Production cookies are `Secure`, `HttpOnly`, `SameSite=Strict`, and scoped to
`/`. The application requires HTTPS, sends HSTS and a restrictive CSP, blocks
framing, and marks authenticated API responses `no-store`. Keep
`SESSION_SECRET` in Secret Manager and rotate it through a planned forced
logout.

Both frontend production builds disable source maps. After building, verify
that neither `web/default/dist` nor `web/classic/dist` contains `.map` files,
and scan emitted assets for secret environment variable names before release.

Run `./ops/verify-production-config.sh` with the candidate revision's injected
environment before shifting traffic. It validates only presence, type, URL
scheme, and positive numeric bounds; it never prints secret values.

Before production billing traffic, apply and verify the append-only ledger
permissions described in `migrations/BILLING_LEDGER_PERMISSIONS.md`. The
verification command must run against the real Cloud SQL instance; a local
dry-run only validates script structure and generated SQL.

## Schema migration versions

Every database uses the same migration record:

```text
schema_migrations(version, name, checksum, applied_at)
```

`version` is the unique migration identity and `checksum` is the SHA-256 of the
reviewed dialect-specific SQL file. A version already recorded with a different
name or checksum is a deployment blocker. The `schema_migration_locks` singleton
row is reserved for database-level runner serialization; do not delete it.

SQLite migrations run through the application migration runner after GORM has
created the base application tables. The runner:

- obtains a SQLite database write lock by updating the singleton lock row;
- executes only versions absent from `schema_migrations`;
- applies DDL and records the version in one transaction;
- reconciles the three historical `ALTER TABLE` migrations column by column;
- validates column affinity, nullability, defaults, index columns, uniqueness,
  and partial-index predicates before recording a version;
- rejects checksum conflicts and incompatible existing schema.

Do not execute these SQLite files directly during deployment:

```text
20260713_03_expand_billing_ledgers.sql
20260713_04_async_task_billing_state.sql
20260714_06_api_key_security.sql
```

SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; direct
re-execution is intentionally replaced by the versioned runner.

MySQL and PostgreSQL keep the same record semantics but remain an operator-run
migration in production. Before application deployment:

1. Apply `migrations/<database>/20260714_00_schema_migrations.sql` with the
   migration account.
2. Acquire the database migration lock using the deployment migration tool.
3. Calculate each reviewed file checksum with
   `shasum -a 256 migrations/<database>/<file>.sql`.
4. Apply each unrecorded migration in version order.
5. Run the relevant schema readiness checks.
6. Insert `version`, `name`, the exact lowercase checksum, and the application
   timestamp only after the migration and validation succeed.
7. Abort when an existing version has a different name or checksum.

MySQL DDL can implicitly commit, so the migration tool must retain its database
lock through post-DDL validation and version insertion. PostgreSQL should keep
transactional DDL and the version insert in the same transaction. Local tests
perform only static validation of these two dialects; execute and verify them
on a restored production-version database before release.

## Secure outbound requests and SSRF

All application-controlled HTTP(S) and WebSocket upstream traffic uses the
shared secure outbound transport. It validates the URL on every request and
redirect, resolves DNS again at dial time, rejects the entire answer set when
any address is private or special-purpose, and dials the validated IP directly.
The transport does not inherit `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY`.

Production must set:

```bash
APP_ENV=production
OUTBOUND_ALLOW_HTTP=false
OUTBOUND_MAX_REDIRECTS=3
OUTBOUND_MAX_REQUEST_BYTES=67108864
OUTBOUND_MAX_RESPONSE_BYTES=134217728
OUTBOUND_CONNECT_TIMEOUT_SECONDS=10
OUTBOUND_TLS_HANDSHAKE_TIMEOUT_SECONDS=10
OUTBOUND_RESPONSE_HEADER_TIMEOUT_SECONDS=30
OUTBOUND_REQUEST_TIMEOUT_SECONDS=600
TLS_INSECURE_SKIP_VERIFY=false
```

Run `./ops/verify-outbound-security-readiness.sh` before deployment. The
application also fails startup when the persisted FetchSetting disables SSRF
protection, permits private IPs, or skips DNS IP validation.

If a channel requires an explicit proxy, add its exact credential-free URL to
`OUTBOUND_TRUSTED_PROXY_URLS` through deployment configuration. Proxy
credentials in URLs are rejected. A proxy is a security trust boundary: verify
that it independently blocks private networks and cloud metadata before adding
it to the trusted list.

Apply channel and custom OAuth URL changes only through administrator routes.
The application validates them before persistence, validates them again at use
time, and records a management audit containing only a host digest.

## Stripe production rollout

Stripe secrets are environment-only. The application never reads
`StripeApiSecret` or `StripeWebhookSecret` from the `options` table, never adds
them to `common.OptionMap`, and never returns them through the system settings
API. Inject both values from Secret Manager as runtime environment variables:

```bash
STRIPE_MODE=live
STRIPE_SECRET_KEY=<Secret Manager reference>
STRIPE_WEBHOOK_SECRET=<Secret Manager reference>
STRIPE_SUCCESS_URL=https://your-domain.example/console/log
STRIPE_CANCEL_URL=https://your-domain.example/console/topup
```

Do not store real values in this repository, Cloud Run plain-text environment
configuration, the database, or Notion. With `APP_ENV=production`, startup
fails when either Stripe secret is missing, when a test key is supplied, or
when `STRIPE_MODE` does not match the key type.

If an older deployment stored Stripe secrets in the `options` table, first
rotate those credentials in Stripe and update Secret Manager. Preview the
targeted cleanup SQL, then execute it against the intended database:

```bash
DB_TYPE=mysql ./ops/cleanup-legacy-stripe-secrets.sh
DB_TYPE=mysql \
CONFIRM_DELETE_LEGACY_STRIPE_SECRETS=YES \
./ops/cleanup-legacy-stripe-secrets.sh --execute
```

The cleanup only deletes the four legacy Stripe secret option keys. It does
not print their values and does not touch any other option.

Deployment order:

1. Back up the database.
2. Apply `migrations/<database>/20260713_05_stripe_payment_safety.sql`.
3. Run `./ops/verify-stripe-payment-schema.sh` against the real database.
   Missing or invalid unique indexes fail with a non-zero exit code. Configure
   one of:
   - MySQL: `DB_TYPE=mysql`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`,
     `MYSQL_DATABASE`, and `MYSQL_PWD` through Secret Manager.
   - PostgreSQL: `DB_TYPE=postgres` and standard `PGHOST`, `PGPORT`, `PGUSER`,
     `PGDATABASE`, `PGPASSWORD` variables.
   - SQLite: `DB_TYPE=sqlite` and `SQLITE_PATH`.
4. Deploy the application with Secret Manager references for both Stripe
   secrets and confirm the recovery worker starts.
5. Configure the Stripe Dashboard endpoint as
   `https://<server>/api/stripe/webhook`.
6. Subscribe to Checkout Session completion/expiration/async-payment events,
   Payment Intent success/failure/cancellation, and `charge.refunded`.
7. Enable Webhook delivery only after migration and schema verification pass.
8. Send a signed Stripe test event in a non-production environment and verify
   the payment order, event, credit ledger, and audit records.

The anonymous request body limit applies before signature verification and
defaults to 512 KiB. Test and live events must use separate keys and webhook
secrets.

Rollback is data preserving: disable Stripe checkout/webhooks, stop the
recovery worker, deploy the previous revision, and retain all Stripe payment,
event, credit-ledger, and audit tables for reconciliation. Follow
`migrations/ROLLBACK_20260713_STRIPE_PAYMENT_SAFETY.md`.
