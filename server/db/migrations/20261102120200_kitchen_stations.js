// Kitchen Display System: shared-station PIN login for kitchen staff (one tablet per shift,
// unlocked by a short PIN) rather than individual admin_users accounts — there's no individual
// identity to hang a login off, so this is its own table/strategy (stationBearer), not a new
// admin_users.role value.
//
// Unlike the other control-plane tables (admin_users/tenant_api_keys), this one needs TWO access
// patterns, not one:
//   1. Anonymous PIN login (POST /kitchen/session) runs with no tenant context yet (station_code
//      is the only thing known, same as apiKeyIsValid's bcrypt-loop-over-all-active-keys
//      pattern) — needs a broad, tenant-blind SELECT, same as admin_users/tenant_api_keys'
//      app_select policy.
//   2. Owner self-service CRUD (create/rotate/revoke a station from strawberry-admin Settings)
//      runs as an authenticated adminBearer request with a resolved tenant_id already set via
//      onPreHandler's GUC — this is a normal tenant-scoped write, so it gets the standard
//      tenant_isolation policy like any other tenant-scoped table.
//   3. The login/refresh endpoints' own write (storing session_token_hash after a successful PIN
//      check) has no onPreHandler-set GUC either (route is auth: false) — the handler must open
//      its own transaction and explicitly set_config('app.current_tenant_id', ...) using the
//      tenant_id from the row it just found, the same way onPreHandler does for normal routes,
//      so that write is covered by tenant_isolation too rather than needing a third policy.
//
// Postgres combines multiple permissive policies for the same command with OR, so adding both
// app_select (SELECT only, tenant-blind) and tenant_isolation (all commands, tenant-scoped) is
// safe: an anonymous SELECT succeeds via app_select; a scoped SELECT/INSERT/UPDATE/DELETE
// succeeds via tenant_isolation. Unlike admin_users/tenant_api_keys, APP_ROLE gets INSERT/
// UPDATE/DELETE here too, since writes are meant to go through ordinary app requests (owner UI,
// login/refresh handlers), not superuser-run scripts.

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
    await knex.schema.createTable('kitchen_stations', (t) => {
        t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('tenant_id').notNullable().references('id').inTable('tenants');
        t.string('name').notNullable();
        t.string('station_code', 12).notNullable().unique();
        t.string('pin_hash').notNullable();
        t.string('session_token_hash').nullable();
        t.timestamp('session_expires_at', { useTz: true }).nullable();
        t.timestamp('revoked_at', { useTz: true }).nullable();
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw('ALTER TABLE kitchen_stations ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE kitchen_stations FORCE ROW LEVEL SECURITY');

    await knex.raw(`
        CREATE POLICY tenant_isolation ON kitchen_stations
        USING (tenant_id = app_current_tenant_id())
        WITH CHECK (tenant_id = app_current_tenant_id())
    `);

    await knex.raw(`
        CREATE POLICY app_select ON kitchen_stations
        FOR SELECT TO ${APP_ROLE}
        USING (true)
    `);

    await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON kitchen_stations TO ${APP_ROLE}`);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.raw(`REVOKE SELECT, INSERT, UPDATE, DELETE ON kitchen_stations FROM ${APP_ROLE}`);
    await knex.raw('DROP POLICY IF EXISTS app_select ON kitchen_stations');
    await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON kitchen_stations');
    await knex.raw('ALTER TABLE kitchen_stations DISABLE ROW LEVEL SECURITY');
    await knex.schema.dropTableIfExists('kitchen_stations');
}
