
import tables from '../utils/tables.js';
const tableName = tables.product_types;


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable(
        tableName,
        (t) => {
            t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
            t.boolean('published').defaultTo(true);
            t.string('name').notNullable();
            t.integer('value').nullable();
            t.string('slug').nullable();
            t.string('description').nullable();
            t.json('metadata').nullable();
            t.integer('ordinal').nullable().defaultTo(1);
            t.timestamp('created_at', true).notNullable().defaultTo(knex.fn.now());
            t.timestamp('updated_at', true).nullable();

            t.index([
                'id'
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
