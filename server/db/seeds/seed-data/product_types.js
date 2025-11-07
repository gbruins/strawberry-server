import tables from '../../utils/tables.js';

const tableName = tables.product_types;

function seed(knex) {
    return knex(tableName)
        .del()
        // .then(() => {
        //     return knex.raw(`ALTER SEQUENCE ${tableName}_id_seq RESTART WITH 1`);
        // })
        .then(
            () => {
                const promises = [];

                const sampleData = {
                    product_type: [
                        { name: 'Pizza', slug: 'pizza', description: 'pizza description' }
                    ]
                };

                for(const key in sampleData) {
                    const fibs = [];

                    sampleData[key].forEach((obj, index) => {
                        const fibonacci = index === 0 ? 1 : fibs[index-1] * 2
                        fibs.push(fibonacci);

                        promises.push(
                            knex(tableName).insert({
                                published: true,
                                ...obj,
                                value: fibonacci,
                                metadata: JSON.stringify([
                                    obj.metadata || {"property":"sample","value":"meta data"}
                                ]),
                                ordinal: index + 1
                            })
                        )
                    })
                }

                return Promise.all(promises);
            }
        );
};


export default {
    seed
}
