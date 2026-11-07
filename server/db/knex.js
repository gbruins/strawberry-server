import knex from 'knex';
import { attachPaginate } from 'knex-paginate';
import knexConfig from '../knexfile.js';

// Runtime app queries use a restricted, non-owner/non-superuser Postgres role so Row-Level
// Security policies actually apply. Verified empirically: with the owner/superuser connection
// (DB_USER), RLS was silently bypassed — identical row counts under three different tenant
// contexts, including a nonexistent one (specs/004-multi-tenant-supabase/research.md #3
// addendum). Migrations still run as DB_USER via knexfile.js directly through the `knex` CLI,
// since DDL (CREATE TABLE, CREATE POLICY, GRANT) needs owner/superuser privileges.
const appConnection = {
    ...knexConfig.connection,
    user: process.env.SUPABASE_APP_DB_USER || process.env.DB_APPUSER || knexConfig.connection.user,
    password: process.env.SUPABASE_APP_DB_PASS || process.env.DB_APPUSER_PASSWORD || knexConfig.connection.password
};

const db = knex({
    ...knexConfig,
    connection: appConnection
});
attachPaginate(); // Attach pagination plugin

export default db;
