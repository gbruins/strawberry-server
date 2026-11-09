// A PII-free signal table the storefront's Supabase Realtime subscription watches instead of
// `carts`/`cart_items` directly — those hold customer billing data that an anonymous storefront
// visitor must never receive over Realtime (RLS scopes which rows are visible, not which
// columns, so a naive subscription on those tables would leak every other customer's name/
// email/address). This table has nothing in it but a tenant id and a timestamp; the storefront
// just refetches GET /services/next (unchanged, still computes everything server-side) whenever
// its own tenant's row changes. See ServiceActivity.js for the write side.
//
// Created AFTER 96_multi_tenant_foundation.js's TENANT_SCOPED_TABLES loop already ran, so it
// gets no tenant_id/RLS for free — this replicates that same manual block, same as
// tenant_pickup_counters (20251106130000_pickup_codes.js) and kitchen_stations did for their
// own new tables.

// SUPABASE_APP_DB_USER is "<role>.<project-ref>" via Supavisor (see 96_multi_tenant_foundation.js) — strip the suffix for SQL.
const APP_ROLE = (process.env.SUPABASE_APP_DB_USER || process.env.DB_APPUSER || 'appuser').split('.')[0];

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(APP_ROLE)) {
    throw new Error(`DB_APPUSER "${APP_ROLE}" is not a safe SQL identifier`);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable('tenant_service_activity', (t) => {
        t.uuid('tenant_id').primary().references('id').inTable('tenants');
        t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw('ALTER TABLE tenant_service_activity ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE tenant_service_activity FORCE ROW LEVEL SECURITY');

    // Scoped read/write for the app's own backend connection (touchServiceActivity's upsert).
    await knex.raw(`
        CREATE POLICY tenant_isolation ON tenant_service_activity
        USING (tenant_id = app_current_tenant_id())
        WITH CHECK (tenant_id = app_current_tenant_id())
    `);
    await knex.raw(`GRANT SELECT, INSERT, UPDATE ON tenant_service_activity TO ${APP_ROLE}`);

    // Additive policy for Supabase Realtime's own connection (the `authenticated` role a
    // self-signed token assumes — see realtimeJwt.js) — same shape as kitchen's
    // kitchen_realtime_select on `carts`, but with no extra claim to check since this table
    // has nothing sensitive in it: any token correctly scoped to a tenant may read its row.
    await knex.raw(`
        CREATE POLICY storefront_realtime_select ON tenant_service_activity
        FOR SELECT TO authenticated
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    `);
    await knex.raw(`GRANT SELECT ON tenant_service_activity TO authenticated`);

    await knex.raw(`ALTER PUBLICATION supabase_realtime ADD TABLE tenant_service_activity`);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.raw(`ALTER PUBLICATION supabase_realtime DROP TABLE tenant_service_activity`);
    await knex.raw(`REVOKE SELECT ON tenant_service_activity FROM authenticated`);
    await knex.raw('DROP POLICY IF EXISTS storefront_realtime_select ON tenant_service_activity');
    await knex.raw(`REVOKE SELECT, INSERT, UPDATE ON tenant_service_activity FROM ${APP_ROLE}`);
    await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON tenant_service_activity');
    await knex.raw('ALTER TABLE tenant_service_activity DISABLE ROW LEVEL SECURITY');
    await knex.schema.dropTableIfExists('tenant_service_activity');
}
