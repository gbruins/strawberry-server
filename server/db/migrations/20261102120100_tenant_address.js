// Kitchen Display System: tenants had no physical store address on file (only name/timezone/
// status). The order-ready completion email needs to tell the customer where to pick up, so the
// owner-facing Settings page (strawberry-admin) lets an owner fill these in. All nullable since
// existing tenants have none set yet — the completion email degrades gracefully (omits the
// address block) rather than failing when these are blank. No RLS change: tenants already has
// an app_select policy (96_multi_tenant_foundation.js) covering reads for this new data too.

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.alterTable('tenants', (t) => {
        t.string('address_line1').nullable();
        t.string('address_line2').nullable();
        t.string('address_city').nullable();
        t.string('address_state').nullable();
        t.string('address_postal_code').nullable();
        t.string('address_phone').nullable();
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.alterTable('tenants', (t) => {
        t.dropColumn('address_line1');
        t.dropColumn('address_line2');
        t.dropColumn('address_city');
        t.dropColumn('address_state');
        t.dropColumn('address_postal_code');
        t.dropColumn('address_phone');
    });
}
