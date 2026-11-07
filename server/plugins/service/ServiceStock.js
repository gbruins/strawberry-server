import db from '../../db/knex.js';
import { PIZZA_SLUG } from '../productTypes/builtInProductTypes.js';

export const HOLD_MARGIN_MS = 60 * 1000;
export const PROVISIONAL_HOLD_MS = 31 * 60 * 1000;

/**
 * Joins a product (`p`) to its type (`pt`). Type values are only unique per tenant, so the
 * tenant must match too, or queries run without RLS (scripts, the owner connection) would
 * match every tenant's type with that value.
 */
export function joinProductType() {
    this.on('pt.value', '=', 'p.product_type').andOn('pt.tenant_id', '=', 'p.tenant_id');
}


/**
 * Only products whose product type is Pizza count toward inventory, holds and
 * the per-order cap. Drinks, sides and anything else are ignored.
 */
function pizzaItemsQuery(knex) {
    return knex('cart_items as ci')
        .join('carts as c', 'c.id', 'ci.cart_id')
        .join('products as p', knex.raw(`p.id = (ci.product->>'id')::uuid`))
        .join('product_types as pt', joinProductType)
        .whereNull('ci.deleted_at')
        .whereNull('c.deleted_at')
        .where('pt.slug', PIZZA_SLUG);
}


export async function countPaidPizzas(serviceId, knex = db) {
    const row = await pizzaItemsQuery(knex)
        .where('c.service_id', serviceId)
        .whereNotNull('c.closed_at')
        .sum({ qty: 'ci.qty' })
        .first();

    return Number(row?.qty || 0);
}


/**
 * Pizzas held by open checkouts: carts not yet paid whose hold has not expired.
 * `checkout_expires_at` is authoritative, so Stripe is never asked.
 */
export async function countHeldPizzas(serviceId, { now = new Date(), excludeCartId = null } = {}, knex = db) {
    const query = pizzaItemsQuery(knex)
        .where('c.service_id', serviceId)
        .whereNull('c.closed_at')
        .where('c.checkout_expires_at', '>', now);

    if(excludeCartId) {
        query.whereNot('c.id', excludeCartId);
    }

    const row = await query.sum({ qty: 'ci.qty' }).first();

    return Number(row?.qty || 0);
}


export async function countCartPizzas(cartId, { excludeProductId = null } = {}, knex = db) {
    const query = pizzaItemsQuery(knex).where('c.id', cartId);

    if(excludeProductId) {
        query.whereRaw(`(ci.product->>'id') <> ?`, [excludeProductId]);
    }

    const row = await query.sum({ qty: 'ci.qty' }).first();

    return Number(row?.qty || 0);
}


export async function isPizzaProduct(productId, knex = db) {
    const row = await knex('products as p')
        .join('product_types as pt', joinProductType)
        .where('p.id', productId)
        .where('pt.slug', PIZZA_SLUG)
        .first('p.id');

    return !!row;
}


/**
 * Remaining pizzas for a service. Pass `excludeCartId` to ignore that cart's own hold.
 */
export async function getRemaining(service, { now = new Date(), excludeCartId = null } = {}, knex = db) {
    const [paid, held] = await Promise.all([
        countPaidPizzas(service.id, knex),
        countHeldPizzas(service.id, { now, excludeCartId }, knex)
    ]);

    return Math.max(0, service.inventory_count - paid - held);
}


export function openServiceQuery(knex, now) {
    return knex('service')
        .where('start_at', '<=', now)
        .where('end_at', '>', now)
        .orderBy('start_at', 'asc');
}


export async function getOpenService(now = new Date(), knex = db) {
    return openServiceQuery(knex, now).first();
}


/**
 * A conflict error carrying a machine-readable code. The Boom data is copied into the
 * response body by the server's onPreResponse extension.
 */
export function limitError(Boom, code, extra = {}) {
    const messages = {
        no_open_service: 'The shop is not open right now.',
        service_closed: 'The shop is not open right now.',
        sold_out: 'Sorry, we are sold out.',
        over_limit: 'That is more pizzas than you can order.'
    };

    return Boom.conflict(messages[code] || code, { code, ...extra });
}
