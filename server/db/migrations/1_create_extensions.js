export const config = { transaction: false };

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'); // Enable UUID extension, for the uuid_generate_v4() function
}



/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    // Optionally, you could drop the extension here:
    // await knex.raw('DROP EXTENSION IF EXISTS "uuid-ossp"');
}
