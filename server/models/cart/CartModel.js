import Joi from 'joi';
import BaseModel from '../BaseModel.js';

function getJoiStringOrNull(strLen) {
    return Joi.alternatives().try(
        Joi.string().trim().max(strLen || 100),
        Joi.allow(null)
    );
}

export default class CartModel extends BaseModel {

    constructor() {
        super();
        this.tableName = this.tables.carts;
        this.hidden = ['deleted_at'];

        this.schema = {
            id: Joi.string().uuid().allow(null),
            billing_firstName: getJoiStringOrNull(),
            billing_lastName: getJoiStringOrNull(),
            billing_company: getJoiStringOrNull(),
            billing_streetAddress: getJoiStringOrNull(),
            billing_extendedAddress: getJoiStringOrNull(),
            billing_city: getJoiStringOrNull(),
            billing_state: getJoiStringOrNull(),
            billing_postalCode: getJoiStringOrNull(),
            billing_countryCodeAlpha2: getJoiStringOrNull(2),
            billing_phone: getJoiStringOrNull(),
            currency: Joi.alternatives().try(
                Joi.string().empty(''),
                Joi.allow(null)
            ),
            stripe_payment_intent_id: getJoiStringOrNull(),
            stripe_order_id: getJoiStringOrNull(),
            sales_tax: Joi.alternatives().try(
                Joi.number().integer().min(0),
                Joi.allow(null)
            ),
            admin_order_notes: Joi.alternatives().try(
                Joi.array(),
                Joi.allow(null)
            ),
            created_at: Joi.date(),
            updated_at: Joi.date(),
            deleted_at: Joi.date(),
            closed_at: Joi.date(),
            shipped_at: Joi.date()
        }
    }

}
