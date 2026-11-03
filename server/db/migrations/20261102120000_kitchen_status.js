// Kitchen Display System: adds fulfillment tracking to carts so kitchen staff can move a paid
// order through queued -> in_progress -> completed. Deliberately nullable with no default
// (unlike tenants.status) — a cart is only a kitchen "ticket" once it's paid, so this is set
// explicitly to 'queued' by CheckoutService.completeCartFromSession() alongside closed_at/
// pickup_code, never backfilled for historical rows. `kitchen_status IS NOT NULL` is the
// kanban board's own filter for "this is a ticket."
//
// kitchen_ready_email_sent_at is an idempotency guard, not a display field: the completion-email
// side effect is gated on a conditional `UPDATE ... WHERE kitchen_ready_email_sent_at IS NULL`
// so two tablets completing the same ticket near-simultaneously only ever send one email.
// carts already has RLS/tenant_id from 96_multi_tenant_foundation.js — no policy changes needed.

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.alterTable('carts', (t) => {
        t.enu('kitchen_status', ['queued', 'in_progress', 'completed']).nullable();
        t.timestamp('kitchen_status_updated_at', { useTz: true }).nullable();
        t.timestamp('kitchen_ready_email_sent_at', { useTz: true }).nullable();
        t.index(['tenant_id', 'kitchen_status']);
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.alterTable('carts', (t) => {
        t.dropIndex(['tenant_id', 'kitchen_status']);
        t.dropColumn('kitchen_status');
        t.dropColumn('kitchen_status_updated_at');
        t.dropColumn('kitchen_ready_email_sent_at');
    });
}
