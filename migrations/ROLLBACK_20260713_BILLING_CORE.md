# Billing core rollback

This migration is intentionally rolled back without deleting billing data.

1. Stop application instances that run the new billing worker.
2. Deploy the previous application version.
3. Keep `billing_requests`, `billing_jobs`, and the added `billing_ledgers`
   columns in place. Older application versions ignore these tables and columns.
4. Do not drop ledger, request, or job rows during an incident rollback. They
   are required for reconciliation and for replaying pending refunds.
5. After the previous version is stable, export all rows whose request or job
   status is not terminal for manual reconciliation.

Dropping the new tables or ledger columns is a destructive schema downgrade and
is not part of the production rollback procedure.
