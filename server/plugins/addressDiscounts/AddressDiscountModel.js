import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'address_discounts';

export default class AddressDiscountModel extends BaseModel {
    constructor() {
        super();
        this.tableName = tableName;
        this.hidden = [];
        this.schema = {
            id: Joi.string().uuid(),
            street_number: Joi.string().max(20),
            allowed_street_id: Joi.string().uuid(),
            discount_percent: Joi.number(),
            active: Joi.boolean(),
            created_at: Joi.date(),
            updated_at: Joi.date()
        };
    }
}
