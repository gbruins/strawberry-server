import product_types from '../../plugins/productTypes/db-seed.js';

// NOTE: products should not be seeded because they also require Stripe setup

// Rows in every seeded table are tenant-scoped (migration 96), but `knex seed:run` has no way
// to pass which tenant to seed for. Set SEED_TENANT_ID explicitly, or leave it unset when
// there's exactly one tenant (the common local-dev case) or a tenant named "Sellout Pizza"
// (the platform owner's own, backfilled by migration 96) to seed.
async function resolveSeedTenantId(knex) {
    if (process.env.SEED_TENANT_ID) {
        return process.env.SEED_TENANT_ID;
    }

    const tenants = await knex('tenants').select('id', 'name');

    if (tenants.length === 1) {
        return tenants[0].id;
    }

    const defaultTenant = tenants.find((t) => t.name === 'Sellout Pizza');

    if (defaultTenant) {
        return defaultTenant.id;
    }

    throw new Error(
        `Multiple tenants exist and none is named "Sellout Pizza" — set SEED_TENANT_ID to the ` +
        `tenant you want to seed. Tenants found: ${tenants.map((t) => `${t.name} (${t.id})`).join(', ')}`
    );
}

/**
 * @param knex
 * @param Promise
 * @returns {*}
 */
export async function seed(knex, Promise) {
    const tenantId = await resolveSeedTenantId(knex);

    await product_types.seed(knex, tenantId);
};
