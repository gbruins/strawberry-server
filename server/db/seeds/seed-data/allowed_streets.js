import tables from '../../utils/tables.js';

const tableName = tables.allowed_streets;

/**
 * Seed data for allowed_streets table
 * @param { import('knex').Knex } knex
 */
async function seed(knex) {
    await knex(tableName).del();
    await knex(tableName).insert([
        {
            street_name: 'Strawberry Circle',
            active: true
        },
        {
            street_name: 'Ginger Loop',
            active: true
        },
        {
            street_name: 'Forest Park Circle',
            active: false
        }
    ]);
}

export default {
    seed
}
