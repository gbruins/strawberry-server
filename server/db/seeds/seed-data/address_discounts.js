import tables from '../../utils/tables.js';

const tableName = tables.address_discounts;

/**
 * Seed data for address_discounts table
 * @param { import('knex').Knex } knex
 */
async function seed(knex) {
    // await knex(tableName).del();
    // await knex(tableName).insert([
    //     {
    //         street_number: '123',
    //         allowed_street_id: '',
    //         discount_percent: 100,
    //         active: true
    //     }
    // ]);
}

export default {
    seed
}
