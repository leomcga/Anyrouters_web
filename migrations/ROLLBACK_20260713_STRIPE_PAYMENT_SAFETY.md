# Stripe payment safety rollback

This migration is data preserving. Do not drop the new payment tables after
they have received production events or credits.

1. Disable Stripe Checkout creation and the Stripe webhook route.
2. Stop the Stripe payment recovery worker.
3. Deploy the previous application version.
4. Keep `stripe_payment_orders`, `stripe_webhook_events`,
   `payment_credit_ledgers`, and `payment_audits` read-only for reconciliation.
5. Before any later retry, compare `payment_credit_ledgers` with user balances
   and the legacy `top_ups` / `subscription_orders` rows.

Only an empty, never-used development database may drop the four new tables.
