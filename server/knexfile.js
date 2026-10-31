import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cloneDeep from 'lodash.clonedeep';
const isProd = process.env.NODE_ENV === 'production';
// Supabase vars take priority when set (specs/004-multi-tenant-supabase); DB_* vars remain as
// the legacy self-hosted Postgres fallback for any environment that hasn't been cut over yet.
const usingSupabase = !!process.env.SUPABASE_DB_HOST;
// Supabase's direct connection is signed by Supabase's own root CA, not one in Node's default
// trust store, so verification needs this cert pinned explicitly rather than skipped.
const supabaseCaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'certs/supabase-ca.crt');

const common = {
    client: 'postgres',

    // https://knexjs.org/guide/#pool
    pool: {
        min: 2,
        max: 10,
        afterCreate: (conn, done) => {
            // in this example we use pg driver's connection API
            conn.query("SET TIME ZONE 'UTC'",  (err) => {
                done(err, conn);
            });
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
        host: process.env.SUPABASE_DB_HOST || process.env.DB_HOST || 'localhost',
        port: process.env.SUPABASE_DB_PORT || process.env.DB_PORT || 5432,
        user: process.env.SUPABASE_DB_USER || process.env.DB_USER,
        password: process.env.SUPABASE_DB_PASS || process.env.DB_PASS,
        database: process.env.SUPABASE_DB_NAME || process.env.DB_NAME,
        // Supabase's direct (session-mode) connection requires TLS; local Postgres doesn't use it.
        ssl: usingSupabase
            ? { ca: fs.readFileSync(supabaseCaPath, 'utf8'), rejectUnauthorized: true }
            : false
    },

    debug: !isProd
};

const config = {
    development: cloneDeep(common),
    production: cloneDeep(common)
};

const env = isProd ? 'production' : 'development';

export default config[env];
