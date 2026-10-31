import Boom from '@hapi/boom';
import db from '../../db/knex.js';
import ServiceMenuModel from './ServiceMenuModel.js';
import BaseService from '../base/BaseService.js';
import ServiceStream from '../service/ServiceStream.js';

export default class ServiceMenuService extends BaseService {

    constructor() {
        super(new ServiceMenuModel());
    }


    /**
     * Products on a menu in display order. Store callers only get published,
     * non-deleted products; admins also get a `published` flag per product.
     */
    async getProducts(menuId, { publishedOnly = false, trx = db } = {}) {
        const qb = trx('service_menu_products as smp')
            .join('products as p', 'p.id', 'smp.product_id')
            .where('smp.service_menu_id', menuId)
            .whereNull('p.deleted_at')
            .orderByRaw('smp.ordinal ASC NULLS LAST')
            .orderBy('p.title')
            .select('p.id', 'p.title', 'p.description', 'p.base_price', 'p.published', 'smp.ordinal');

        if(publishedOnly) {
            qb.where('p.published', true);
        }

        return qb;
    }


    /**
     * Replaces the products on a menu and their order with the given list.
     */
    async setProducts(menuId, productIds, trx = db, tenantId) {
        const ids = productIds || [];

        if(new Set(ids).size !== ids.length) {
            throw Boom.badRequest('A product can only be on a menu once');
        }

        if(ids.length) {
            const found = await trx('products')
                .whereIn('id', ids)
                .whereNull('deleted_at')
                .count({ count: '*' })
                .first();

            if(Number(found.count) !== ids.length) {
                throw Boom.badRequest('One or more products do not exist');
            }
        }

        await trx('service_menu_products').where({ service_menu_id: menuId }).del();

        if(ids.length) {
            await trx('service_menu_products').insert(
                ids.map((product_id, i) => ({
                    tenant_id: tenantId,
                    service_menu_id: menuId,
                    product_id,
                    ordinal: i + 1
                }))
            );
        }

        ServiceStream.publish(tenantId);

        return this.getProducts(menuId, { trx });
    }


    /**
     * Open or upcoming services that use each of the given menus.
     */
    async getServicesByMenu(menuIds, trx = db) {
        if(!menuIds.length) {
            return {};
        }

        const rows = await trx('service')
            .whereIn('service_menu_id', menuIds)
            .where('end_at', '>', trx.fn.now())
            .orderBy('start_at')
            .select('id', 'service_menu_id', 'start_at', 'end_at');

        const out = {};
        rows.forEach(({ service_menu_id, ...svc }) => {
            (out[service_menu_id] ||= []).push(svc);
        });

        return out;
    }


    async addRelations(results, trx = db) {
        const list = Array.isArray(results) ? results : [results];
        const ids = list.filter(Boolean).map((m) => m.id);

        if(!ids.length) {
            return results;
        }

        const counts = await trx('service_menu_products as smp')
            .join('products as p', 'p.id', 'smp.product_id')
            .whereIn('smp.service_menu_id', ids)
            .whereNull('p.deleted_at')
            .groupBy('smp.service_menu_id')
            .select('smp.service_menu_id')
            .count({ count: '*' });

        const countMap = Object.fromEntries(counts.map((c) => [c.service_menu_id, Number(c.count)]));
        const services = await this.getServicesByMenu(ids, trx);

        list.filter(Boolean).forEach((m) => {
            m.product_count = countMap[m.id] || 0;
            m.services = services[m.id] || [];
        });

        return results;
    }

}
