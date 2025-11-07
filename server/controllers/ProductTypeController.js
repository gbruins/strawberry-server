import Boom from '@hapi/boom';
import BaseController from './BaseController.js';
import ProductTypeService from '../services/ProductTypeService.js';

export default class ProductTypeController extends BaseController {

    constructor() {
        super(new ProductTypeService());
    }


    async addProductTypeHandler(request, h) {
        try {
            global.logger.info('REQUEST: ProductTypeController.addProductTypeHandler', {
                meta: request.payload
            });

            const ProductType = await this.service.addProductType(request.payload);

            global.logger.info('RESPONSE: ProductTypeController.addProductTypeHandler', {
                meta: ProductType
            });

            return h.apiSuccess(ProductType);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async updateProductTypeHandler(request, h) {
        try {
            global.logger.info('REQUEST: ProductTypeController.updateProductTypeHandler', {
                meta: request.payload
            });

            const ProductType = await this.service.update({
                data: request.payload,
                where: { id: request.payload.id }
             });

            global.logger.info('RESPONSE: ProductTypeController.updateProductTypeHandler', {
                meta: ProductType
            });

            return h.apiSuccess(ProductType);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }

}
