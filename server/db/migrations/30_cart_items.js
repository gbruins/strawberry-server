
import tables from '../utils/tables.js';
const tableName = tables.cart_items;


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable(
        tableName,
        (t) => {
            t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
            t.integer('qty').nullable();
            t.jsonb('product').nullable();
            t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
            t.timestamp('updated_at', { useTz: true }).nullable();
            t.timestamp('deleted_at', { useTz: true }).nullable();

            // Foreign Keys:
            t.uuid('cart_id')
                .notNullable()
                .references('id')
                .inTable(tables.carts)
                .onDelete('CASCADE');

            t.index([
                'id',
                'cart_id'
            ]);
        }
    );
}


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.dropTableIfExists(tableName);
}
