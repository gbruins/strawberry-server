// Kitchen Display System: owners need to self-service their tenant's physical address (filled
// in from a new strawberry-admin Settings page) without shell/script access — unlike
// admin_users/tenant_api_keys, which stay script-only writes (96_multi_tenant_foundation.js's
// comment: "writes happen only via scripts run as the owner, not through arbitrary app
// requests"). This is a deliberate, narrow exception: an owner may update ONLY the address
// columns on ONLY their own tenant row — never name/timezone/status, and never another
// tenant's row.
//
// tenants.id IS the tenant's own id (there's no separate tenant_id column to compare against,
// unlike every other RLS-policied table here) — the policy compares `id` to the GUC directly.
// Column-level GRANT (rather than table-level) means even a bug in the handler code can't let
// this write path touch status/name/timezone — the database itself won't allow it.

// SUPABASE_APP_DB_USER is "<role>.<project-ref>" via Supavisor (see 96_multi_tenant_foundation.js) — strip the suffix for SQL.
const APP_ROLE = (process.env.SUPABASE_APP_DB_USER || process.env.DB_APPUSER || 'appuser').split('.')[0];

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(APP_ROLE)) {
    throw new Error(`DB_APPUSER "${APP_ROLE}" is not a safe SQL identifier`);
}

const ADDRESS_COLUMNS = 'address_line1, address_line2, address_city, address_state, address_postal_code, address_phone';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.raw(`
        CREATE POLICY tenant_self_address_update ON tenants
        FOR UPDATE TO ${APP_ROLE}
        USING (id = app_current_tenant_id())
        WITH CHECK (id = app_current_tenant_id())
    `);

    await knex.raw(`GRANT UPDATE (${ADDRESS_COLUMNS}) ON tenants TO ${APP_ROLE}`);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.raw(`REVOKE UPDATE (${ADDRESS_COLUMNS}) ON tenants FROM ${APP_ROLE}`);
    await knex.raw(`DROP POLICY IF EXISTS tenant_self_address_update ON tenants`);
}
