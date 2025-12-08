import { tableName as allowedStreetsTable } from './AllowedStreetModel.js';

/**
 * Seed data for allowed_streets table
 * @param { import('knex').Knex } knex
 */
async function seed(knex) {
    await knex(allowedStreetsTable).del();
    await knex(allowedStreetsTable).insert([
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
