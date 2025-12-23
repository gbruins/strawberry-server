import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'products';

export default class ProductModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tableName;
        this.hidden = [];
        this.schema = {
            id: Joi.string().uuid(),
            title: Joi.string().max(255),
            description: Joi.string().allow(null),
            product_type: Joi.number().integer(),
            base_price: Joi.number().integer().allow(null),
            published: Joi.boolean(),
            stripe_price_id: Joi.string().allow(null),
            stripe_product_id: Joi.string().allow(null),
            stripe_tax_code: Joi.string().allow(null),
            created_at: Joi.date(),
            updated_at: Joi.date(),
            deleted_at: Joi.date().allow(null)
        }
    }

}
