import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'product_types';

export default class ProductTypeModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tableName;
        this.hidden = [];
        this.schema = {
            id: Joi.string().uuid(),
            published: Joi.boolean(),
            name: Joi.string().max(100),
            value: Joi.number().integer().min(0),
            slug: Joi.string().allow('').allow(null),
            description: Joi.string().max(500).allow('').allow(null),
            // metadata: Joi.array().allow(null),
            metadata: Joi.alternatives().try(
                Joi.array(),
                Joi.string(),
                Joi.allow(null)
            ),
            ordinal: Joi.number().integer().min(0).allow(null),
            created_at: Joi.date(),
            updated_at: Joi.date()
        }
    }

}
