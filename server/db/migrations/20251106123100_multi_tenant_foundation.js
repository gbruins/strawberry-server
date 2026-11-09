// Multi-tenant foundation (specs/004-multi-tenant-supabase): tenants, admin_users,
// tenant_api_keys, tenant_id on every existing tenant-scoped table, and the Row-Level Security
// policies that enforce isolation (research.md #3). One consolidated migration — see tasks.md's
// "Migration numbering note": Knex sorts migration filenames as plain strings, so this must sort
// after 20251106122900_cart_customer_note.js (confirmed empirically), and this is a fresh, pre-launch
// database with no need for separately revertible steps.

// The restricted, non-owner/non-superuser role the app's runtime connection uses
// (server/db/knex.js) so RLS actually applies — migrations themselves still run as the
// owner/superuser DB_USER, which is why this grant step is needed at all. This role must
// already exist (created once per database, same as today's local `appuser` — see
// README/T001 for the Supabase equivalent); this migration only grants privileges to it.
// Through Supavisor, SUPABASE_APP_DB_USER is "<role>.<project-ref>" (the format knex.js needs
// for the actual pooled connection) — GRANT needs just the bare role name, so drop the suffix.
const APP_ROLE = (process.env.SUPABASE_APP_DB_USER || process.env.DB_APPUSER || 'appuser').split('.')[0];

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(APP_ROLE)) {
    throw new Error(`DB_APPUSER "${APP_ROLE}" is not a safe SQL identifier`);
}

const TENANT_SCOPED_TABLES = [
    'products',
    'product_types',
    'carts',
    'cart_items',
    'service',
    'service_menus',
    'service_menu_products',
    'allowed_streets',
    'address_discounts'
];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable('tenants', (t) => {
        t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
        t.string('name').notNullable();
        t.string('timezone').notNullable().defaultTo('America/Los_Angeles');
        t.enu('status', ['active', 'suspended']).notNullable().defaultTo('active');
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('admin_users', (t) => {
        // Equals the corresponding auth.users.id (Supabase-managed identity) — not a foreign
        // key across schemas, enforced by the signup/invite flow instead (data-model.md).
        t.uuid('id').primary().unique();
        t.uuid('tenant_id').nullable().references('id').inTable('tenants');
        t.enu('role', ['owner']).notNullable().defaultTo('owner');
        t.boolean('is_platform_staff').notNullable().defaultTo(false);
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    // XOR: exactly one of (tenant_id set) / (is_platform_staff) must hold — an owner belongs
    // to one tenant; platform staff belong to none (data-model.md validation rules).
    await knex.raw(`
        ALTER TABLE admin_users ADD CONSTRAINT admin_users_tenant_or_platform_staff
        CHECK ((tenant_id IS NOT NULL) <> is_platform_staff)
    `);

    await knex.schema.createTable('tenant_api_keys', (t) => {
        t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('tenant_id').notNullable().references('id').inTable('tenants');
        t.string('key_hash').notNullable();
        t.timestamp('revoked_at', { useTz: true }).nullable();
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    // Safely read the tenant GUC as a nullable uuid. Plain `current_setting(name, true)::uuid`
    // is NOT enough: that only returns SQL NULL for a connection that has NEVER touched this
    // GUC. Once any transaction on a given pooled connection has set it, Postgres resets a
    // custom placeholder GUC to '' (empty string) at commit, not back to "never set" — so a
    // later transaction on the *same reused connection* that sets no context at all gets ''
    // instead of NULL, and ''::uuid throws (found by QA testing a pool pinned to size 1, then
    // confirmed against the real pool). NULLIF collapses both "never set" (NULL) and "reset to
    // empty" ('') to NULL before the cast, so both cases correctly fail closed (0 rows) instead
    // of throwing.
    await knex.raw(`
        CREATE FUNCTION app_current_tenant_id() RETURNS uuid
        LANGUAGE sql STABLE AS $$
            SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
        $$
    `);

    // Backfill: the platform owner's existing data becomes its own first tenant.
    const [defaultTenant] = await knex('tenants')
        .insert({ name: 'Sell Out Pizza' })
        .returning('id');
    const defaultTenantId = defaultTenant.id;

    for (const table of TENANT_SCOPED_TABLES) {
        await knex.schema.alterTable(table, (t) => {
            t.uuid('tenant_id').nullable().references('id').inTable('tenants');
        });

        await knex(table).update({ tenant_id: defaultTenantId });

        await knex.raw(`ALTER TABLE ${table} ALTER COLUMN tenant_id SET NOT NULL`);

        await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        // Table owners and superusers bypass RLS regardless of ENABLE — verified empirically
        // (identical row counts under three different tenant contexts without this). FORCE
        // makes the policy apply to the owner too; it still does NOT apply to a superuser,
        // which is why the app's runtime connection must also not be one (see server/db/knex.js
        // and the DB_APPUSER grants below — research.md #3 addendum).
        await knex.raw(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        await knex.raw(`
            CREATE POLICY tenant_isolation ON ${table}
            USING (tenant_id = app_current_tenant_id())
            WITH CHECK (tenant_id = app_current_tenant_id())
        `);

        await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${APP_ROLE}`);
    }

    // Control-plane tables have no per-row tenant_id policy (a request must be able to look up
    // admin_users/tenant_api_keys BEFORE a tenant is known, to determine the tenant in the
    // first place), but the app role only gets SELECT — writes happen only via scripts run as
    // the owner (makeApiKey.js, onboardTenant.js), not through arbitrary app requests.
    //
    // Explicitly enabling RLS here (rather than relying on it being off, which is plain
    // Postgres's default) matters because Supabase auto-enables RLS on every new public-schema
    // table regardless of what this migration does — verified empirically against a fresh
    // Supabase project, where it silently turned the GRANT SELECT below into deny-all for
    // strawberry_app (RLS enabled + zero policies = default-deny for non-owners). Local Postgres
    // has no such behavior, so this only surfaced once tested against Supabase directly. Making
    // it explicit, with a matching permissive policy, keeps this migration's behavior identical
    // on both.
    for (const table of ['tenants', 'admin_users', 'tenant_api_keys']) {
        await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await knex.raw(`
            CREATE POLICY app_select ON ${table}
            FOR SELECT TO ${APP_ROLE}
            USING (true)
        `);
    }

    await knex.raw(`GRANT SELECT ON tenants TO ${APP_ROLE}`);
    await knex.raw(`GRANT SELECT ON admin_users TO ${APP_ROLE}`);
    await knex.raw(`GRANT SELECT ON tenant_api_keys TO ${APP_ROLE}`);

    // Narrow, auditable RLS bypass for exactly one case: the Stripe webhook
    // (POST /stripe/webhook, auth: false — authenticated by Stripe's signature, not a
    // tenant-bearing session) needs to know which tenant a given cart belongs to BEFORE any
    // tenant context exists, to set that context for everything else it does. SECURITY DEFINER
    // runs with the privileges of this function's owner (the migration-owning role, i.e. the
    // same owner/superuser that already bypasses RLS) regardless of who calls it — so this is
    // the one deliberate, single-purpose exception, not a blanket bypass: it returns exactly
    // one column of exactly one table for exactly one id.
    await knex.raw(`
        CREATE FUNCTION get_cart_tenant_id(p_cart_id uuid) RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
            SELECT tenant_id FROM carts WHERE id = p_cart_id;
        $$
    `);
    await knex.raw(`GRANT EXECUTE ON FUNCTION get_cart_tenant_id(uuid) TO ${APP_ROLE}`);
}


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    for (const table of TENANT_SCOPED_TABLES) {
        await knex.raw(`REVOKE SELECT, INSERT, UPDATE, DELETE ON ${table} FROM ${APP_ROLE}`);
        await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON ${table}`);
        await knex.raw(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
        await knex.schema.alterTable(table, (t) => {
            t.dropColumn('tenant_id');
        });
    }

    for (const table of ['tenants', 'admin_users', 'tenant_api_keys']) {
        await knex.raw(`DROP POLICY IF EXISTS app_select ON ${table}`);
        await knex.raw(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }

    await knex.raw(`REVOKE SELECT ON tenants FROM ${APP_ROLE}`);
    await knex.raw(`REVOKE SELECT ON admin_users FROM ${APP_ROLE}`);
    await knex.raw(`REVOKE SELECT ON tenant_api_keys FROM ${APP_ROLE}`);

    await knex.raw('DROP FUNCTION IF EXISTS get_cart_tenant_id(uuid)');
    await knex.raw('DROP FUNCTION IF EXISTS app_current_tenant_id()');

    await knex.schema.dropTableIfExists('tenant_api_keys');
    await knex.schema.dropTableIfExists('admin_users');
    await knex.schema.dropTableIfExists('tenants');
}
