import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'notification_sends';

export default class NotificationSendModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tableName;
        this.hidden = [];
        this.schema = {
            id: Joi.string().uuid(),
            service_id: Joi.string().uuid(),
            recipient_count: Joi.number().integer().min(0),
            sent_at: Joi.date()
        }
    }
}
