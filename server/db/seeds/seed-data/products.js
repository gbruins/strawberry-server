import tables from '../../utils/tables.js';

const tableName = tables.products;

async function seed(knex) {
    return knex(tableName)
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
                        ...obj
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
