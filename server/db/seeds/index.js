import address_discounts from './seed-data/address_discounts.js';
import allowed_streets from './seed-data/allowed_streets.js';
import product_types from './seed-data/product_types.js';
import products from './seed-data/products.js';

/**
 * @param knex
 * @param Promise
 * @returns {*}
 */
export async function seed(knex, Promise) {
    await address_discounts.seed(knex);
    await allowed_streets.seed(knex);
    await product_types.seed(knex);
    await products.seed(knex);
};
