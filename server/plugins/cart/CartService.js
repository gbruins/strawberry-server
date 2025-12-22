import Joi from 'joi';
import BaseService from '../base/BaseService.js';
import CartModel from './CartModel.js';
import CartItemService from './CartItemService.js';
import { makeArray } from '../../utils/utils.js';

export default class CartService extends BaseService {

    constructor() {
        super(new CartModel());
        this.CartItemService = new CartItemService();
    }


    getValidationSchemaForSearch() {
        const schema = {
            ...super.getValidationSchemaForSearch()
        }

        schema.deleted_at = Joi.alternatives().try(
            Joi.date(),
            Joi.allow(null)
        );

        schema.closed_at = Joi.alternatives().try(
            Joi.date(),
            Joi.object(),
            Joi.allow(null)
        );

        schema.shipped_at = Joi.alternatives().try(
            Joi.date(),
            Joi.allow(null)
        );

        // test
        schema.where = Joi.object();

        return schema;
    }


    addRelations(carts) {
        return this.CartItemService.addRelationToCarts(carts);
    }


    formatForUpsert(data) {
        if (data.admin_order_notes) {
            const v = data.admin_order_notes;

            if (v === null) {
                data.admin_order_notes = null;
            }
            else if (typeof v === 'string') {
                // assume already serialized
            }
            else {
                try {
                    data.admin_order_notes = JSON.stringify(v);
                }
                catch (e) {
                    // leave as-is; DB will error and surface the problem
                }
            }
        }

        return data;
    }

    getActiveCart(id) {
        if(!id) {
            return false;
        }

        return this.fetchOne({
            where: {
                id: id,
                closed_at: { 'is_null': true }
            }
        });
    }

    async getOrCreateCart(id) {
        const Cart = await this.getActiveCart(id);

        if(Cart) {
            return Cart;
        }

        return this.create({});
    }


    addVirtuals(data) {
        makeArray(data).forEach((cart) => {
            // num_items
            cart.num_items = (function(obj) {
                let numItems = 0;

                makeArray(obj.cart_items).forEach((model) => {
                    numItems += parseInt(model.qty || 0, 10);
                });

                return numItems;
            })(cart);

            // price_subtotal
            cart.price_subtotal = (function(obj) {
                let subtotal = 0;

                makeArray(obj.cart_items).forEach((model) => {
                    subtotal += model.price_subtotal || 0;
                });

                return subtotal;
            })(cart);

            // grand_total
            cart.grand_total = (function(obj) {
                return (obj.price_subtotal || 0) + (obj.sales_tax || 0);
            })(cart);

            // tax_rate
            cart.tax_rate = (function(obj) {
                const salesTax = obj.sales_tax || 0;
                const grandTotal = obj.grand_total || 0;

                if(!salesTax || !grandTotal) {
                    return null;
                }

                const preTaxGrandTotal = grandTotal - salesTax;
                return (salesTax / preTaxGrandTotal).toFixed(5);
            })(cart);
        });

        return data;
    }
}
