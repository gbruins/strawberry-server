import Joi from 'joi';
import Boom from '@hapi/boom';
import BaseController from '../base/BaseController.js';
import ServiceMenuService from './ServiceMenuService.js';
import ServiceStream from '../service/ServiceStream.js';

// Store (apiKey) callers are public clients: they only see published menus
const isStoreCaller = (request) => request.auth?.strategy === 'apiKey';

export default class ServiceMenuController extends BaseController {

    constructor() {
        super(new ServiceMenuService());
    }


    async searchHandler(request, h) {
        if(isStoreCaller(request)) {
            request.query.published = true;
        }

        return super.searchHandler(request, h);
    }


    async getByIdHandler(request, h) {
        if(isStoreCaller(request)) {
            const menu = await this.service.fetchOne({
                where: { id: request.query.id, published: true },
                trx: request.app.trx
            });

            if(!menu) {
                throw Boom.notFound();
            }

            return h.apiSuccess(menu);
        }

        return super.getByIdHandler(request, h);
    }


    async updateHandler(request, h) {
        const response = await super.updateHandler(request, h);
        ServiceStream.publish(request.app.tenantId);
        return response;
    }


    async deleteHandler(request, h) {
        const response = await super.deleteHandler(request, h);
        ServiceStream.publish(request.app.tenantId);
        return response;
    }


    async getProductsHandler(request, h) {
        const menu = await this.throwIfNotFound(request.query.id, request);
        const storeCaller = isStoreCaller(request);

        if(storeCaller && !menu.published) {
            throw Boom.notFound();
        }

        const products = await this.service.getProducts(menu.id, { publishedOnly: storeCaller, trx: request.app.trx });
        return h.apiSuccess(products);
    }


    async setProductsHandler(request, h) {
        const menu = await this.throwIfNotFound(request.query.id, request);
        const products = await this.service.setProducts(menu.id, request.payload.product_ids, request.app.trx, request.app.tenantId);
        return h.apiSuccess(products);
    }


    async usageHandler(request, h) {
        const menu = await this.throwIfNotFound(request.query.id, request);
        const services = await this.service.getServicesByMenu([menu.id], request.app.trx);
        return h.apiSuccess({ services: services[menu.id] || [] });
    }

    static idQuery = Joi.object({ id: Joi.string().uuid().required() });

}
