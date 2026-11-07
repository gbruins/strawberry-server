/**
 * Product types the platform itself depends on. Every tenant gets these at onboarding and
 * they cannot be deleted or have their slug changed.
 *
 * Pizza is the only one: products of this type are the ones counted toward a service's
 * inventory, checkout holds and `max_per_order` cap (see service/ServiceStock.js). Products
 * of any other type are not limited.
 */
export const PIZZA_SLUG = 'pizza';

export const BUILT_IN_PRODUCT_TYPES = [
    { name: 'Pizza', slug: PIZZA_SLUG, value: 1, description: null, ordinal: 1 }
];

export const BUILT_IN_SLUGS = BUILT_IN_PRODUCT_TYPES.map((type) => type.slug);

export const isBuiltInSlug = (slug) => BUILT_IN_SLUGS.includes(slug);


/**
 * Inserts any missing built-in product types for a tenant. Safe to run more than once.
 *
 * `knex` may be the owner connection (onboarding, seeds, test fixtures), which bypasses RLS,
 * so every query is scoped to `tenantId` explicitly.
 */
export async function ensureBuiltInProductTypes(knex, tenantId) {
    const rows = await knex('product_types')
        .where({ tenant_id: tenantId })
        .select('slug', 'value');

    const slugs = rows.map((row) => row.slug);
    const values = rows.map((row) => row.value).filter((value) => value !== null);
    const missing = BUILT_IN_PRODUCT_TYPES.filter((type) => !slugs.includes(type.slug));

    for(const type of missing) {
        // Keep the preferred value unless another type already uses it
        const value = values.includes(type.value) ? nextTypeValue(values) : type.value;
        values.push(value);

        await knex('product_types').insert({ ...type, value, published: true, tenant_id: tenantId });
    }
}


/**
 * Type values are powers of two. Returns the next one above the highest in use.
 */
export function nextTypeValue(values) {
    const highest = Math.max(0, ...values);

    return highest ? Math.pow(2, Math.floor(Math.log2(highest)) + 1) : 1;
}
