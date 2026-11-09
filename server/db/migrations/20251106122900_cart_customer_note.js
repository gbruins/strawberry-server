import { tableName } from '../../plugins/cart/CartModel.js';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    // Written by the customer; separate from the admin-only admin_order_notes
    await knex.schema.alterTable(tableName, (t) => {
        t.text('customer_note').nullable();
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.alterTable(tableName, (t) => {
        t.dropColumn('customer_note');
    });
}
