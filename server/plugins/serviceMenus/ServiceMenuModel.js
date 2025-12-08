import Joi from 'joi';
import BaseModel from '../base/BaseModel.js';

export const tableName = 'service_menus';
export const tableNameProductsJunction = 'service_menu_products';

export default class ServiceMenuModel extends BaseModel {

    constructor() {
        super();
        this.tableName = tableName;
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
