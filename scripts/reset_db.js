import dotenv from 'dotenv';
dotenv.config();

import { Client } from 'pg';
import knexConfig from '../server/knexfile.js';

// Reuses knexfile.js's own connection config (host/ssl/etc.) rather than reading DB_* env vars
// directly, so this script targets whichever database (Supabase or legacy local Postgres) the
// rest of the app is actually configured to use.
const client = new Client(knexConfig.connection);

async function resetDatabase() {
  await client.connect();

  // Get all tables except knex_migrations and knex_migrations_lock
  const { rows } = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('knex_migrations', 'knex_migrations_lock')
  `);

  // Drop each table
  for (const row of rows) {
    console.log(`Dropping table: ${row.tablename}`);
    await client.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
  }

  // Truncate migration tables
  console.log('Truncating knex_migrations and knex_migrations_lock');
  await client.query('TRUNCATE TABLE knex_migrations, knex_migrations_lock RESTART IDENTITY CASCADE');

  await client.end();
  console.log('Database reset complete.');
}

resetDatabase().catch(err => {
  console.error('Error resetting database:', err);
  process.exit(1);
});
