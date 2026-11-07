// Touches `tenant_service_activity` (20261102120500_tenant_service_activity.js) — the one row
// the storefront's Supabase Realtime subscription watches. Call this from any mutation that
// should make the storefront refetch GET /services/next (hold reserved/released, order paid,
// menu changed) — it replaces the old ServiceStream.publish(tenantId) calls one-for-one.
export async function touchServiceActivity(tenantId, trx) {
    if (!tenantId) {
        return;
    }

    await trx('tenant_service_activity')
        .insert({ tenant_id: tenantId, updated_at: trx.fn.now() })
        .onConflict('tenant_id')
        .merge();
}
