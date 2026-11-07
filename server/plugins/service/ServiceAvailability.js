import Boom from '@hapi/boom';
import db from '../../db/knex.js';
import { touchServiceActivity } from './ServiceActivity.js';
import { joinProductType } from './ServiceStock.js';
import { PIZZA_SLUG } from '../productTypes/builtInProductTypes.js';

/**
 * What a customer can order during a service: the products on the service's published menu,
 * minus the ones marked out of stock for that one service (`service_unavailable_products`).
 * Add-to-cart and checkout both go through here, so they can never disagree.
 */

export function itemUnavailable(productId, title) {
    return Boom.conflict(`"${title || 'An item'}" is no longer available`, {
        code: 'item_unavailable',
        product_id: productId || null,
        title: title || null
    });
}


export async function getUnavailableProductIds(serviceId, trx = db) {
    const rows = await trx('service_unavailable_products')
        .where({ service_id: serviceId })
        .pluck('product_id');

    return new Set(rows);
}


/**
 * Product ids that can be ordered in the service right now. Empty when the service has no
 * published menu.
 */
export async function getOfferedProductIds(serviceId, trx = db) {
    const rows = await trx('service as s')
        .join('service_menus as m', 'm.id', 's.service_menu_id')
        .join('service_menu_products as smp', 'smp.service_menu_id', 'm.id')
        .leftJoin('service_unavailable_products as sup', function() {
            this.on('sup.service_id', '=', 's.id').andOn('sup.product_id', '=', 'smp.product_id');
        })
        .where('s.id', serviceId)
        .where('m.published', true)
        .whereNull('m.deleted_at')
        .whereNull('sup.id')
        .pluck('smp.product_id');

    return new Set(rows);
}


export async function assertProductOrderable(serviceId, product, trx = db) {
    const offered = await getOfferedProductIds(serviceId, trx);

    if(!offered.has(product.id)) {
        throw itemUnavailable(product.id, product.title);
    }
}


/**
 * The service's menu products with whether each is in stock, for the admin stock editor.
 */
export async function getServiceAvailability(serviceId, trx = db) {
    const service = await trx('service').where({ id: serviceId }).first('id', 'service_menu_id');

    if(!service) {
        throw Boom.notFound();
    }

    if(!service.service_menu_id) {
        return [];
    }

    const unavailable = await getUnavailableProductIds(serviceId, trx);

    const products = await trx('service_menu_products as smp')
        .join('products as p', 'p.id', 'smp.product_id')
        .leftJoin('product_types as pt', joinProductType)
        .where('smp.service_menu_id', service.service_menu_id)
        .whereNull('p.deleted_at')
        .orderByRaw('smp.ordinal ASC NULLS LAST')
        .orderBy('p.title')
        .select(
            'p.id', 'p.title', 'p.product_type', 'p.published',
            trx.raw('coalesce(pt.slug = ?, false) as limited', [PIZZA_SLUG])
        );

    return products.map((product) => ({ ...product, available: !unavailable.has(product.id) }));
}


/**
 * Replaces the set of products marked out of stock for a service. Every id must be on the
 * service's menu.
 */
export async function setServiceUnavailable(serviceId, productIds, trx = db, tenantId) {
    const ids = [...new Set(productIds || [])];
    const menuProducts = await getServiceAvailability(serviceId, trx);
    const onMenu = new Set(menuProducts.map((product) => product.id));

    if(ids.some((id) => !onMenu.has(id))) {
        throw Boom.badRequest('Only products on the service\'s menu can be marked out of stock', { code: 'not_on_menu' });
    }

    await trx('service_unavailable_products').where({ service_id: serviceId }).del();

    if(ids.length) {
        await trx('service_unavailable_products').insert(
            ids.map((product_id) => ({ tenant_id: tenantId, service_id: serviceId, product_id }))
        );
    }

    await touchServiceActivity(tenantId, trx);

    return getServiceAvailability(serviceId, trx);
}
