import { tableName } from '../../plugins/cart/CartModel.js';

/**
 * Adds the hash of the anonymous cart access token. The raw token is only
 * ever returned to the client once, when the cart is created.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.alterTable(tableName, (t) => {
        t.string('token_hash', 64).nullable();
    });
}


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.alterTable(tableName, (t) => {
        t.dropColumn('token_hash');
    });
}
