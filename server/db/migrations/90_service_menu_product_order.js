import { tableNameProductsJunction as tableName } from '../../plugins/serviceMenus/ServiceMenuModel.js';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    // Nullable: products without an ordinal sort after ordered ones
    await knex.schema.alterTable(tableName, (t) => {
        t.integer('ordinal').nullable();
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.alterTable(tableName, (t) => {
        t.dropColumn('ordinal');
    });
}
