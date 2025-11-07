import Joi from 'joi';
import BaseModel from './BaseModel.js';
import tables from '../db/utils/tables.js';

export default class ServiceMenuModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tables.service_menus;
        this.hidden = [];
        this.schema = {
            id: Joi.string().uuid(),
            title: Joi.string().max(255),
            description: Joi.string().allow(null),
            published: Joi.boolean(),
            created_at: Joi.date(),
            updated_at: Joi.date(),
            deleted_at: Joi.date().allow(null)
        }
    }

}
