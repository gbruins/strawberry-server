// Pickup codes + order receipt emails: a 3-digit code (unique per tenant per day, reset at the
// tenant's local midnight) shown on the confirmation page so pickup-counter staff can match a
// walk-in customer to their order, plus persisting the email Stripe Checkout already collects
// (session.customer_details.email) so a receipt containing that code can be sent automatically.
//
// tenant_pickup_counters created AFTER 20251106123100_multi_tenant_foundation.js's TENANT_SCOPED_TABLES loop
// already ran, so it gets no tenant_id/RLS for free — this replicates that same block directly,
// same as 20251106123200_email_subscribers.js did for its own new tables.

// SUPABASE_APP_DB_USER is "<role>.<project-ref>" via Supavisor (see 20251106123100_multi_tenant_foundation.js) — strip the suffix for SQL.
const APP_ROLE = (process.env.SUPABASE_APP_DB_USER || process.env.DB_APPUSER || 'appuser').split('.')[0];

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(APP_ROLE)) {
    throw new Error(`DB_APPUSER "${APP_ROLE}" is not a safe SQL identifier`);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.alterTable('carts', (t) => {
        // Collected by Stripe Checkout (session.customer_details.email) but previously
        // discarded by completeCartFromSession() — never stored until now.
        t.string('billing_email').nullable();
        // Allocated once, in the same update that sets closed_at (CheckoutService.js). Display
        // range is 100-999; pickup_code_date is the tenant-local calendar date it was allocated
        // for, used only to make the "which day" boundary explicit/auditable — the actual daily
        // reset is driven by tenant_pickup_counters below, keyed on that same local date.
        t.smallint('pickup_code').nullable();
        t.date('pickup_code_date').nullable();
    });

    // One row per tenant per local day; last_code increments atomically via an upsert
    // (PickupCodeService.js) so concurrent webhook deliveries can never allocate the same code.
    await knex.schema.createTable('tenant_pickup_counters', (t) => {
        t.uuid('tenant_id').notNullable().references('id').inTable('tenants');
        t.date('counter_date').notNullable();
        t.integer('last_code').notNullable().defaultTo(0);
        t.primary(['tenant_id', 'counter_date']);
    });

    await knex.raw('ALTER TABLE tenant_pickup_counters ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE tenant_pickup_counters FORCE ROW LEVEL SECURITY');
    await knex.raw(`
        CREATE POLICY tenant_isolation ON tenant_pickup_counters
        USING (tenant_id = app_current_tenant_id())
        WITH CHECK (tenant_id = app_current_tenant_id())
    `);
    await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_pickup_counters TO ${APP_ROLE}`);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.raw(`REVOKE SELECT, INSERT, UPDATE, DELETE ON tenant_pickup_counters FROM ${APP_ROLE}`);
    await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON tenant_pickup_counters');
    await knex.raw('ALTER TABLE tenant_pickup_counters DISABLE ROW LEVEL SECURITY');
    await knex.schema.dropTableIfExists('tenant_pickup_counters');

    await knex.schema.alterTable('carts', (t) => {
        t.dropColumn('billing_email');
        t.dropColumn('pickup_code');
        t.dropColumn('pickup_code_date');
    });
}
