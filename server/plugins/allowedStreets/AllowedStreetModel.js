import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'allowed_streets';

export default class AllowedStreetModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tableName;
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
