import knexLib from 'knex';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import knexConfig from '../knexfile.js';

// Test fixtures need to write across tenants and bypass RLS by design (setting up isolated
// test data for more than one tenant at once), so this connects as the owner/superuser —
// the same role migrations use — not the app's restricted runtime role.
const ownerDb = knexLib(knexConfig);

export function getApiPrefix(path) {
    const prefix = '/api/v1';
    const suffix = path && path.charAt(0) === '/' ? path : '/' + path;

    return path ? `${prefix}${suffix}` : prefix;
}

/**
 * Creates an isolated tenant (and optionally a product under it) for a test, and returns a
 * cleanup function. Does not touch the real "Sell Out Pizza" backfilled tenant or its data.
 */
export async function createTestTenant({ name, product, withApiKey = false } = {}) {
    const [tenant] = await ownerDb('tenants')
        .insert({ name: name || `Test Tenant ${Date.now()}` })
        .returning('id');

    let productRow = null;
    let apiKey = null;

    if (product) {
        [productRow] = await ownerDb('products')
            .insert({ tenant_id: tenant.id, title: 'Test Product', published: true, ...product })
            .returning('*');
    }

    if (withApiKey) {
        const token = uuidv4().replace(/-/g, '');
        await ownerDb('tenant_api_keys').insert({
            tenant_id: tenant.id,
            key_hash: bcrypt.hashSync(token, bcrypt.genSaltSync(10))
        });
        apiKey = token;
    }

    async function cleanup() {
        // Generic sweep, not just the fixture's own product row: tests may create their own
        // carts/cart_items/etc under this tenant (e.g. by hitting real routes) that would
        // otherwise violate the FK on tenants when it's deleted below.
        await ownerDb('cart_items').where({ tenant_id: tenant.id }).del();
        await ownerDb('carts').where({ tenant_id: tenant.id }).del();
        await ownerDb('products').where({ tenant_id: tenant.id }).del();
        await ownerDb('notification_sends').where({ tenant_id: tenant.id }).del();
        await ownerDb('email_subscribers').where({ tenant_id: tenant.id }).del();
        await ownerDb('tenant_pickup_counters').where({ tenant_id: tenant.id }).del();

        if (withApiKey) {
            await ownerDb('tenant_api_keys').where({ tenant_id: tenant.id }).del();
        }

        await ownerDb('tenants').where({ id: tenant.id }).del();
    }

    return { tenantId: tenant.id, product: productRow, apiKey, cleanup };
}

export async function revokeApiKey(tenantId) {
    await ownerDb('tenant_api_keys').where({ tenant_id: tenantId }).update({ revoked_at: new Date() });
}

export async function suspendTenant(tenantId) {
    await ownerDb('tenants').where({ id: tenantId }).update({ status: 'suspended' });
}

export async function getCart(cartId) {
    return ownerDb('carts').where({ id: cartId }).first();
}

/**
 * Owner-level read access for test verification — bare `db` (server/db/knex.js) is the
 * restricted app role with no ambient tenant context outside a request's own trx, so a direct
 * query against a tenant-scoped table from a test would see zero rows under RLS regardless of
 * what's actually there (research.md #3: this fails closed, not open, but looks like missing
 * data if you forget why). Use this for "did the row I expect actually get written" checks.
 */
export function ownerQuery(tableName) {
    return ownerDb(tableName);
}

// Deliberately no destroyTestDb() export: ownerDb is a module-singleton (ESM caches the module
// across every test file in the same `lab` run), so one file's `after()` destroying it would
// pull the pool out from under every other file's `before()` still to run. Letting the process
// exit naturally when `lab` finishes closes it anyway.
