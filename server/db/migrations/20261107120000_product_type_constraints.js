// Pizza is a built-in product type that the per-order cap, inventory and checkout holds depend
// on (plugins/productTypes/builtInProductTypes.js). These constraints keep that dependency sound:
//
// - One type per slug per tenant: a second "pizza" type would make the stock queries join twice
//   and count every pizza double.
// - One type per value per tenant, and value is required: products point at a type by value.
// - Every product has a type, so nothing silently skips the pizza checks.
//
// Pre-launch database, so no backfill: run scripts/reset_db.js if local rows violate these.

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.alterTable('product_types', (t) => {
        t.integer('value').notNullable().alter();
        t.unique(['tenant_id', 'slug'], { indexName: 'product_types_tenant_slug_unique' });
        t.unique(['tenant_id', 'value'], { indexName: 'product_types_tenant_value_unique' });
    });

    await knex.schema.alterTable('products', (t) => {
        t.integer('product_type').notNullable().alter();
    });
}


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.alterTable('products', (t) => {
        t.integer('product_type').nullable().alter();
    });

    await knex.schema.alterTable('product_types', (t) => {
        t.dropUnique(['tenant_id', 'value'], 'product_types_tenant_value_unique');
        t.dropUnique(['tenant_id', 'slug'], 'product_types_tenant_slug_unique');
        t.integer('value').nullable().alter();
    });
}
