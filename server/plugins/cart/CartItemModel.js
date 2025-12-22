import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'cart_items';

export default class CartItemModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tableName;
        this.hidden = ['deleted_at'];
        this.schema = {
            id: Joi.string().uuid().allow(null),
            product: Joi.alternatives().try(
                Joi.object(),
                Joi.allow(null)
            ),
            qty: Joi.alternatives().try(
                Joi.number().integer().min(0)
            ),
            cart_id: Joi.alternatives().try(
                Joi.string().uuid(),
                Joi.allow(null)
            ),
            created_at: Joi.date(),
            updated_at: Joi.date(),
            deleted_at: Joi.date()
        }
    }

}
