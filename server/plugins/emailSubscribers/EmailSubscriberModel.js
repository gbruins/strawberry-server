import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'email_subscribers';

export default class EmailSubscriberModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tableName;
        this.hidden = [];
        this.schema = {
            id: Joi.string().uuid(),
            email: Joi.string().email().max(255),
            status: Joi.string().valid('subscribed', 'unsubscribed'),
            unsubscribe_token: Joi.string().uuid(),
            subscribed_at: Joi.date(),
            unsubscribed_at: Joi.date().allow(null),
            created_at: Joi.date(),
            updated_at: Joi.date()
        }
    }
}
