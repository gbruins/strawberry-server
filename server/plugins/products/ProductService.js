import Boom from '@hapi/boom';
import ProductModel from './ProductModel.js';
import BaseService from '../base/BaseService.js';
import db from '../../db/knex.js';

export default class ProductService extends BaseService {

    constructor() {
        super(new ProductModel());
    }


    /**
     * A product must point at one of the tenant's product types: the type decides whether the
     * product counts toward a service's inventory and per-order cap.
     */
    async assertProductTypeExists(value, trx = db) {
        const type = await trx('product_types').where({ value }).first('id');

        if(!type) {
            throw Boom.badRequest('Unknown product type', { code: 'unknown_product_type' });
        }
    }


    getValidationSchemaForAdd() {
        const schema = { ...super.getValidationSchemaForAdd() };
        schema.product_type = schema.product_type.required();

        return schema;
    }

}
