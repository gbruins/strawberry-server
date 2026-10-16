import { tableName as tableNameService } from '../../plugins/service/ServiceModel.js';
import { tableName as tableNameCarts } from '../../plugins/cart/CartModel.js';

/**
 * Adds the per-order cap to a service, and links carts to a service with an
 * optional checkout hold expiry.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.alterTable(tableNameService, (t) => {
        t.integer('max_per_order').notNullable().defaultTo(4);
    });
    await knex.raw(`ALTER TABLE ${tableNameService} ADD CONSTRAINT service_max_per_order_min CHECK (max_per_order >= 1)`);

    await knex.schema.alterTable(tableNameCarts, (t) => {
        t.uuid('service_id').nullable().references('id').inTable(tableNameService);
        t.timestamp('checkout_expires_at', { useTz: true }).nullable();
        t.index(['service_id']);
    });
}


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.alterTable(tableNameCarts, (t) => {
        t.dropIndex(['service_id']);
        t.dropColumn('checkout_expires_at');
        t.dropColumn('service_id');
    });
    await knex.raw(`ALTER TABLE ${tableNameService} DROP CONSTRAINT IF EXISTS service_max_per_order_min`);
    await knex.schema.alterTable(tableNameService, (t) => {
        t.dropColumn('max_per_order');
    });
}
