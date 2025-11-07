import tables from '../utils/tables.js';

const tableName = tables.address_discounts;

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable(tableName, (t) => {
        t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
        t.string('street_number').notNullable();
        t.string('street_name').notNullable();
        t.integer('discount_percent').notNullable();
        t.boolean('active').notNullable().defaultTo(true);
        t.timestamp('created_at', true).notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at', true).nullable();

        t.index([
            'id',
            'street_number',
            'street_name'
        ]);
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.dropTableIfExists(tableName);
}
