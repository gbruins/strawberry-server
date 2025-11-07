
import tables from '../utils/tables.js';
const tableName = tables.products;


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable(
        tableName,
        (t) => {
            t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
            t.string('title').nullable();
            t.text('description').nullable();
            t.integer('product_type').nullable();
            t.integer('base_price').nullable().defaultTo(null);
            t.boolean('published').defaultTo(false);

            // STRIPE
            t.string('stripe_price_id').nullable();
            t.string('stripe_product_id').nullable();

            // TIMESTAMPS
            t.timestamp('created_at', true).notNullable().defaultTo(knex.fn.now());
            t.timestamp('updated_at', true).nullable();
            t.timestamp('deleted_at', true).nullable();

            t.index([
                'id',
                'product_type'
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
