// Kitchen Display System: lets the kitchen board subscribe to live changes on `carts` via
// Supabase Realtime. Realtime authorizes rows via RLS evaluated against ITS OWN connection's
// JWT claims (auth.jwt()), which is a completely separate mechanism from this app's own
// app.current_tenant_id GUC (server/plugins/serverExtensions/index.js) — Realtime's Postgres
// connection never touches that GUC, so the existing `tenant_isolation` policy on `carts`
// contributes nothing to it (auth.jwt() is null for app_current_tenant_id() too, so that
// policy's condition is simply never true for a Realtime connection — it fails closed, not
// open). This is an ADDITIVE policy (Postgres OR's multiple permissive policies for the same
// command), not a replacement — the app's own RLS behavior for adminBearer/apiKey/stationBearer
// requests is untouched.
//
// A kitchen station has no Supabase GoTrue session (shared-PIN login, not an individual
// account — see 20261102120200_kitchen_stations.js), so strawberry-server signs its own
// Supabase-compatible JWT (HS256, SUPABASE_JWT_SECRET) with custom claims on login, rather than
// provisioning a hidden per-tenant GoTrue user. `auth.jwt()` reads those claims back out on the
// Realtime connection.
//
// Enabling `carts` on the `supabase_realtime` publication affects every Realtime listener on
// that table, not just the kitchen board — this RLS policy, not any client-side `.eq()` filter
// a subscription applies, is the actual security boundary.

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.raw(`GRANT SELECT ON carts TO authenticated`);

    await knex.raw(`
        CREATE POLICY kitchen_realtime_select ON carts
        FOR SELECT TO authenticated
        USING (
            tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
            AND (auth.jwt() ->> 'kitchen_role') = 'kitchen'
        )
    `);

    await knex.raw(`ALTER PUBLICATION supabase_realtime ADD TABLE carts`);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.raw(`ALTER PUBLICATION supabase_realtime DROP TABLE carts`);
    await knex.raw(`DROP POLICY IF EXISTS kitchen_realtime_select ON carts`);
    await knex.raw(`REVOKE SELECT ON carts FROM authenticated`);
}
