import Joi from 'joi';
import BaseModel from './BaseModel.js';
import tables from '../db/utils/tables.js';

export default class AllowedStreetModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tables.allowed_streets;
        this.hidden = [];
        this.schema = {
            id: Joi.string().uuid(),
            street_name: Joi.string().max(255),
            active: Joi.boolean(),
            created_at: Joi.date(),
            updated_at: Joi.date()
        }
    }

}
