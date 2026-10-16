import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'service';

export default class ServiceModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tableName;
        this.hidden = [];
        this.schema = {
            id: Joi.string().uuid(),
            start_at: Joi.date().allow(null),
            end_at: Joi.date().allow(null),
            notes: Joi.string().allow('', null).optional(),
            inventory_count: Joi.number().integer().min(0),
            service_menu_id: Joi.string().uuid().allow(null),
            max_per_order: Joi.number().integer().min(1),
            created_at: Joi.date(),
            updated_at: Joi.date()
        }
    }

}
