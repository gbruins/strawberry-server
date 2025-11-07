import Joi from 'joi';
import BaseModel from './BaseModel.js';
import tables from '../db/utils/tables.js';

export default class ServiceModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tables.service;
        this.hidden = [];
        this.schema = {
            id: Joi.string().uuid(),
            start_at: Joi.date().allow(null),
            end_at: Joi.date().allow(null),
            notes: Joi.string().allow(null),
            inventory_count: Joi.number().integer().min(0),
            service_menu_id: Joi.string().uuid().allow(null),
            created_at: Joi.date(),
            updated_at: Joi.date()
        }
    }

}
