import { tableNameProductsJunction as tableName } from '../../plugins/serviceMenus/ServiceMenuModel.js';
import { tableName as tableNameServiceMenus } from '../../plugins/serviceMenus/ServiceMenuModel.js';
import { tableName as tableNameProducts } from '../../plugins/products/ProductModel.js';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    /* A service menu can have multiple products,
    * and a product can belong to multiple service menus.
    * This is a many-to-many relationship implemented via a junction table.
    */
    await knex.schema.createTable(tableName, (t) => {
        t.uuid('service_menu_id')
            .notNullable()
            .references('id')
            .inTable(tableNameServiceMenus)
            .onDelete('CASCADE');

        t.uuid('product_id')
            .notNullable()
            .references('id')
            .inTable(tableNameProducts)
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
