import tables from '../../utils/tables.js';

const tableName = tables.address_discounts;

/**
 * Seed data for address_discounts table
 * @param { import('knex').Knex } knex
 */
async function seed(knex) {
    await knex(tableName).del();
    await knex(tableName).insert([
        {
            street_number: '123',
            street_name: 'Strawberry Circle',
            discount_percent: 100,
            active: true
        },
        {
            street_number: '456',
            street_name: 'Ginger Loop',
            discount_percent: 50,
            active: true
        },
        {
            street_number: '789',
            street_name: 'Forest Park Circle',
            discount_percent: 10,
            active: false
        }
    ]);
}

export default {
    seed
}
