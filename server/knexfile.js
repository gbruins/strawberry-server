import cloneDeep from 'lodash.clonedeep';
const isProd = process.env.NODE_ENV === 'production';

const common = {
    client: 'postgres',

    // https://knexjs.org/guide/#pool
    pool: {
        min: 2,
        max: 10,
        afterCreate: function (conn, done) {
            // in this example we use pg driver's connection API
            conn.query('SET timezone="UTC";', function (err) {
                done(err, conn);
            });

            // //test
            // conn.query(`SET app.current_tenant = "11111111-1111-1111-1111-111111111111"`, function (err) {
            //     if(err) {
            //         console.error(err)
            //     }
            //     done(err, conn);
            // });
        }
    },

    migrations: {
        directory: './db/migrations',
        tableName: 'knex_migrations'
    },

    seeds: {
        directory: './db/seeds'
    },

    connection: {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    },

    debug: !isProd
};

const config = {
    development: cloneDeep(common),
    production: cloneDeep(common)
};

const env = isProd ? 'production' : 'development';

export default config[env];
