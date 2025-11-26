import Joi from 'joi';
import BaseModel from './BaseModel.js';
import tables from '../db/utils/tables.js';

export default class AddressDiscountModel extends BaseModel {
    constructor() {
        super();
        this.tableName = tables.address_discounts;
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
