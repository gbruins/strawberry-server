import { tableName } from '../../plugins/service/ServiceModel.js';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable(
        tableName,
        (t) => {
            t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));
            t.timestamp('start_at', { useTz: false }).nullable();
            t.timestamp('end_at', { useTz: false }).nullable();
            t.string('notes').nullable();
            t.integer('inventory_count').defaultTo(0);

            t.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
            t.timestamp('updated_at', { useTz: false }).nullable();

            // Foreign Key
            // A daily service has one service menu
            t.uuid('service_menu_id')
                .notNullable()
                .references('id')
                .inTable(tables.service_menus)
                .nullable();

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
