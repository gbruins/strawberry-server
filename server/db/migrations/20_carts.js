
import tables from '../utils/tables.js';
const tableName = tables.carts;


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable(
        tableName,
        (t) => {
            t.uuid('id').primary().unique().defaultTo(knex.raw('uuid_generate_v4()'));

            t.string('billing_firstName').nullable();
            t.string('billing_lastName').nullable();
            t.string('billing_company').nullable();
            t.string('billing_streetAddress').nullable();
            t.string('billing_extendedAddress').nullable();
            t.string('billing_city').nullable();
            t.string('billing_state').nullable();
            t.string('billing_postalCode').nullable();
            t.string('billing_countryCodeAlpha2', 2).nullable();
            t.string('billing_phone').nullable();

            t.string('currency').notNullable().defaultTo('usd');
            t.string('stripe_payment_intent_id').nullable();
            t.string('stripe_order_id').nullable();
            t.integer('sales_tax').nullable();
            t.jsonb('admin_order_notes').nullable();

            t.timestamp('created_at', true).notNullable().defaultTo(knex.fn.now());
            t.timestamp('updated_at', true).nullable();
            t.timestamp('deleted_at', true).nullable();
            t.timestamp('closed_at', true).nullable();
            t.timestamp('shipped_at', true).nullable();

            t.index([
                'id'
            ]);
        }
    );
}


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.dropTableIfExists(tableName);
}
