import db from '../../db/knex.js';
import { getRemaining, joinProductType } from './ServiceStock.js';
import { PIZZA_SLUG } from '../productTypes/builtInProductTypes.js';

const serviceFields = ['id', 'start_at', 'end_at', 'notes', 'inventory_count', 'max_per_order'];

// The storefront shows where to pick up an order (hero, cart, confirmation page). These are
// the same owner-editable columns as PUT /tenant/address — public information by nature.
const SHOP_ADDRESS_FIELDS = ['address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code', 'address_phone'];

const publicShop = (t) => ({
    name: t.name ?? null,
    address_line1: t.address_line1 ?? null,
    address_line2: t.address_line2 ?? null,
    address_city: t.address_city ?? null,
    address_state: t.address_state ?? null,
    address_postal_code: t.address_postal_code ?? null,
    phone: t.address_phone ?? null
});

const toIso = (v) => (v ? new Date(v).toISOString() : null);

const publicService = (s) => ({
    id: s.id,
    start_at: toIso(s.start_at),
    end_at: toIso(s.end_at),
    notes: s.notes ?? null,
    inventory_count: s.inventory_count,
    max_per_order: s.max_per_order
});


async function fetchPublishedMenu(service, knex = db) {
    if(!service.service_menu_id) {
        return null;
    }

    const menu = await knex('service_menus')
        .where({ id: service.service_menu_id, published: true })
        .whereNull('deleted_at')
        .first('id', 'title', 'description');

    if(!menu) {
        return null;
    }

    // `limited`: whether the product counts toward the service's max_per_order and inventory.
    // `available`: false when marked out of stock for this service (still listed, not orderable).
    const products = await knex('service_menu_products as smp')
        .join('products as p', 'p.id', 'smp.product_id')
        .leftJoin('product_types as pt', joinProductType)
        .leftJoin('service_unavailable_products as sup', function() {
            this.on('sup.product_id', '=', 'smp.product_id').andOn('sup.service_id', '=', knex.raw('?', [service.id]));
        })
        .where('smp.service_menu_id', menu.id)
        .where('p.published', true)
        .whereNull('p.deleted_at')
        .orderByRaw('smp.ordinal ASC NULLS LAST')
        .orderBy('p.title')
        .select(
            'p.id', 'p.title', 'p.description', 'p.base_price', 'p.image',
            // The storefront groups the menu into one section per type, in menu order
            'p.product_type', 'pt.name as type_name',
            knex.raw('coalesce(pt.slug = ?, false) as limited', [PIZZA_SLUG]),
            knex.raw('sup.id is null as available')
        );

    return { ...menu, products };
}


/**
 * Builds the read model for the storefront: the current or next service, its
 * status, the pizzas remaining and the published menu.
 */
export async function buildState(now = new Date(), knex = db, tenantId = null) {
    const state = {
        status: 'none',
        server_now: now.toISOString(),
        timezone: null,
        shop: null,
        service: null,
        next_service: null
    };

    // `tenants` has no tenant_isolation RLS policy (control-plane table, readable by any
    // tenant's connection — research.md #3's third addendum), so the row has to be filtered
    // explicitly by tenantId rather than relying on RLS the way every other query here does.
    if (tenantId) {
        const tenant = await knex('tenants').where({ id: tenantId }).first('timezone', 'name', ...SHOP_ADDRESS_FIELDS);
        state.timezone = tenant?.timezone ?? null;
        state.shop = tenant ? publicShop(tenant) : null;
    }

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

    state.remaining = await getRemaining(current, { now }, knex);
    state.menu = await fetchPublishedMenu(current, knex);
    state.status = state.remaining > 0 ? 'open' : 'sold_out';

    if(state.status === 'sold_out' && services[1]) {
        state.next_service = publicService(services[1]);
    }

    return state;
}
