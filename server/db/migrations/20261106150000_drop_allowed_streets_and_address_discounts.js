// The allowed-streets and address-discounts features were removed (API plugins, admin screens,
// storefront config fetch). Nothing has shipped to production, so the tables are just dropped.
import * as allowedStreets from './20251106120000_allowed_streets.js';
import * as addressDiscounts from './20251106121000_address_discounts.js';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.dropTableIfExists('address_discounts');
    await knex.schema.dropTableIfExists('allowed_streets');
}

/**
 * Recreates the empty tables (data is not restored) with a nullable tenant_id, so that rolling
 * back further through 96_multi_tenant_foundation (which drops tenant_id from them) still works.
 * RLS/grants are not restored.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    for (const [migration, table] of [[allowedStreets, 'allowed_streets'], [addressDiscounts, 'address_discounts']]) {
        await migration.up(knex);
        await knex.schema.alterTable(table, (t) => {
            t.uuid('tenant_id').nullable().references('id').inTable('tenants');
        });
    }
}
