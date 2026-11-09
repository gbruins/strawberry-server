// Per-service "out of stock" (plugins/service/ServiceAvailability.js): a product on a service's
// menu that can't be ordered during that one service. Rows only ever narrow what the menu
// offers, so the next service starts with everything in stock again.
//
// Created after 96_multi_tenant_foundation.js's TENANT_SCOPED_TABLES loop, so it replicates the
// same tenant_isolation RLS block directly (as 97_email_subscribers.js does).

// SUPABASE_APP_DB_USER is "<role>.<project-ref>" via Supavisor (see 96_multi_tenant_foundation.js) — strip the suffix for SQL.
const APP_ROLE = (process.env.SUPABASE_APP_DB_USER || process.env.DB_APPUSER || 'appuser').split('.')[0];

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(APP_ROLE)) {
    throw new Error(`DB_APPUSER "${APP_ROLE}" is not a safe SQL identifier`);
}

const TABLE = 'service_unavailable_products';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable(TABLE, (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('tenant_id').notNullable().references('id').inTable('tenants');
        t.uuid('service_id').notNullable().references('id').inTable('service').onDelete('CASCADE');
        t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('CASCADE');
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.unique(['service_id', 'product_id'], { indexName: 'service_unavailable_products_unique' });
    });

    await knex.raw(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY`);
    await knex.raw(`
        CREATE POLICY tenant_isolation ON ${TABLE}
        USING (tenant_id = app_current_tenant_id())
        WITH CHECK (tenant_id = app_current_tenant_id())
    `);
    await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${TABLE} TO ${APP_ROLE}`);
}


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.raw(`REVOKE SELECT, INSERT, UPDATE, DELETE ON ${TABLE} FROM ${APP_ROLE}`);
    await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON ${TABLE}`);
    await knex.schema.dropTableIfExists(TABLE);
}
