
import tables from '../utils/tables.js';
const tableName = tables.service_menus;


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
            t.boolean('published').defaultTo(false);

            // TIMESTAMPS
            t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
            t.timestamp('updated_at', { useTz: true }).nullable();
            t.timestamp('deleted_at', { useTz: true }).nullable();

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
