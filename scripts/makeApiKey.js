// dotenv is loaded via `--require dotenv/config` (see package.json's make-api-key script),
// not here: ESM import declarations are hoisted above any other top-level code regardless of
// source order, so a `dotenv.config()` call in this file would run AFTER `knexfile.js` below
// has already read process.env.DB_* at import time — hit this directly (it silently connected
// to the wrong database instead of failing loudly, since DB_USER undefined still resolves to
// some default). This matches every other script in this repo (knex:migrate, knex:seed, dev).
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import knexConfig from '../server/knexfile.js';

// Runs as the owner/superuser (knexfile.js's DB_USER) — same as migrations — since
// tenant_api_keys only grants the restricted app role SELECT, not INSERT (data-model.md:
// writes happen only via scripts run as the owner, not through arbitrary app requests).
const db = knexLib(knexConfig);

const tenantId = process.argv[2];

if (!tenantId) {
    console.error('Usage: node scripts/makeApiKey.js <tenant-id>');
    console.error('List tenants: npm run knex:migrate first, then query the tenants table.');
    process.exit(1);
}

async function main() {
    const tenant = await db('tenants').where({ id: tenantId }).first('id', 'name');

    if (!tenant) {
        console.error(`No tenant found with id ${tenantId}`);
        process.exit(1);
    }

    const salt = bcrypt.genSaltSync(10);
    const token = uuidv4().replace(/-/g, '');
    const hash = bcrypt.hashSync(token, salt);

    await db('tenant_api_keys').insert({ tenant_id: tenantId, key_hash: hash });

    console.log(`API KEY FOR ${tenant.name}'s STOREFRONT (give this to its own deployment's VITE_API_KEY — specs/004-multi-tenant-supabase research.md #9):`);
    console.log(token);

    await db.destroy();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
