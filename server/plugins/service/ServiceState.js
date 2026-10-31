import db from '../../db/knex.js';
import { getRemaining } from './ServiceStock.js';

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
        .orderByRaw('smp.ordinal ASC NULLS LAST')
        .orderBy('p.title')
        .select('p.id', 'p.title', 'p.description', 'p.base_price');

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
        service: null,
        next_service: null
    };

    // `tenants` has no tenant_isolation RLS policy (control-plane table, readable by any
    // tenant's connection — research.md #3's third addendum), so the row has to be filtered
    // explicitly by tenantId rather than relying on RLS the way every other query here does.
    if (tenantId) {
        const tenant = await knex('tenants').where({ id: tenantId }).first('timezone');
        state.timezone = tenant?.timezone ?? null;
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
    state.menu = await fetchPublishedMenu(current.service_menu_id, knex);
    state.status = state.remaining > 0 ? 'open' : 'sold_out';

    if(state.status === 'sold_out' && services[1]) {
        state.next_service = publicService(services[1]);
    }

    return state;
}


/**
 * Like buildState(), but for callers with no ambient request transaction (the SSE hub's
 * background timer and its cross-tenant publish() calls — ServiceStream.js) — opens its own
 * short transaction scoped to the given tenant.
 */
export async function buildStateForTenant(tenantId, now = new Date()) {
    return db.transaction(async (trx) => {
        await trx.raw('SELECT set_config(?, ?, true)', ['app.current_tenant_id', tenantId]);
        return buildState(now, trx, tenantId);
    });
}
