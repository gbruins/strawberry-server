import Joi from 'joi';
import BaseModel from './BaseModel.js';
import tables from '../db/utils/tables.js';

export default class ProductModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tables.products;
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
            created_at: Joi.date(),
            updated_at: Joi.date(),
            deleted_at: Joi.date().allow(null)
        }
    }

}
