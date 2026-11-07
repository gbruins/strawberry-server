import { tableName } from './ProductTypeModel.js';
import { ensureBuiltInProductTypes } from './builtInProductTypes.js';

/**
 * Resets the tenant's product types to just the built-in ones (Pizza).
 */
async function seed(knex, tenantId) {
    await knex(tableName).where({ tenant_id: tenantId }).del();
    await ensureBuiltInProductTypes(knex, tenantId);
}


export default {
    seed
}
