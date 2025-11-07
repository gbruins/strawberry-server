import tables from '../utils/tables.js';
const tableName = tables.service_menu_products;

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable(tableName, (t) => {
        t.uuid('service_menu_id')
            .notNullable()
            .references('id')
            .inTable(tables.service_menus)
            .onDelete('CASCADE');

        t.uuid('product_id')
            .notNullable()
            .references('id')
            .inTable(tables.products)
            .onDelete('CASCADE');

        t.primary(['service_menu_id', 'product_id']);
        t.index(['service_menu_id']);
        t.index(['product_id']);
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.dropTableIfExists(tableName);
}
