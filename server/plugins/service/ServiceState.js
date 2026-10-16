import db from '../../db/knex.js';

const serviceFields = ['id', 'start_at', 'end_at', 'notes', 'inventory_count', 'max_per_order'];

const toIso = (v) => (v ? new Date(v).toISOString() : null);

const publicService = (s) => ({
    id: s.id,
    start_at: toIso(s.start_at),
    end_at: toIso(s.end_at),
    notes: s.notes ?? null,
    inventory_count: s.inventory_count,
    max_per_order: s.max_per_order
});


/**
 * Pizzas sold on paid (closed) carts for a service. Only items whose product
 * type is Pizza count; the product type is read from the products table.
 */
export async function countPaidPizzas(serviceId, knex = db) {
    const row = await knex('cart_items as ci')
        .join('carts as c', 'c.id', 'ci.cart_id')
        .join('products as p', db.raw(`p.id = (ci.product->>'id')::uuid`))
        .join('product_types as pt', 'pt.value', 'p.product_type')
        .where('c.service_id', serviceId)
        .whereNotNull('c.closed_at')
        .whereNull('ci.deleted_at')
        .where('pt.slug', 'pizza')
        .sum({ qty: 'ci.qty' })
        .first();

    return Number(row?.qty || 0);
}


async function fetchPublishedMenu(menuId, knex = db) {
    if(!menuId) {
        return null;
    }

    const menu = await knex('service_menus')
        .where({ id: menuId, published: true })
        .whereNull('deleted_at')
        .first('id', 'title', 'description');

    if(!menu) {
        return null;
    }

    const products = await knex('service_menu_products as smp')
        .join('products as p', 'p.id', 'smp.product_id')
        .where('smp.service_menu_id', menu.id)
        .where('p.published', true)
        .whereNull('p.deleted_at')
        .orderBy('p.title')
        .select('p.id', 'p.title', 'p.description', 'p.base_price');

    return { ...menu, products };
}


/**
 * Builds the read model for the storefront: the current or next service, its
 * status, the pizzas remaining and the published menu.
 */
export async function buildState(now = new Date(), knex = db) {
    const state = {
        status: 'none',
        server_now: now.toISOString(),
        service: null,
        next_service: null
    };

    const services = await knex('service')
        .where('end_at', '>', now)
        .whereNotNull('start_at')
        .orderBy('start_at', 'asc')
        .limit(2)
        .select([...serviceFields, 'service_menu_id']);

    const current = services[0];
    if(!current) {
        return state;
    }

    state.service = publicService(current);

    if(new Date(current.start_at) > now) {
        state.status = 'upcoming';
        return state;
    }

    const paid = await countPaidPizzas(current.id, knex);
    state.remaining = Math.max(0, current.inventory_count - paid);
    state.menu = await fetchPublishedMenu(current.service_menu_id, knex);
    state.status = state.remaining > 0 ? 'open' : 'sold_out';

    if(state.status === 'sold_out' && services[1]) {
        state.next_service = publicService(services[1]);
    }

    return state;
}
