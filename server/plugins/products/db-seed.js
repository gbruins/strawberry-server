import { tableName } from './ProductModel.js';

async function seed(knex, tenantId) {
    return knex(tableName)
        .where({ tenant_id: tenantId })
        .del()
        // .then(() => {
        //     return knex.raw(`ALTER SEQUENCE ${tables.product_artists}_id_seq RESTART WITH 1`);
        // })
        .then(async () => {
            const data = [
                {
                    title: 'Margherita Pizza',
                    description: 'prod 1 desc',
                },
                {
                    title: 'Pepperoni Pizza',
                    description: 'prod 2 desc',
                },
                {
                    title: 'Cheese Pizza',
                    description: 'prod 3 desc',
                }
            ];

            const promises = [];

            data.forEach((obj) => {
                promises.push(
                    knex(tableName).insert({
                        published: true,
                        base_price: 1500,
                        product_type: 1,
                        stripe_tax_code: 'txcd_40060003',
                        ...obj,
                        tenant_id: tenantId
                    })
                );
            });

            return Promise.all(promises);
        }
    );
}

export default {
    seed
}
