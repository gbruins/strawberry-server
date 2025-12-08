import address_discounts from '../../plugins/addressDiscounts/db-seed.js';
import allowed_streets from '../../plugins/allowedStreets/db-seed.js';
import product_types from '../../plugins/productTypes/db-seed.js';
import products from '../../plugins/products/db-seed.js';

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
