import crypto from 'crypto';
import Joi from 'joi';
import BaseService from '../base/BaseService.js';
import CartModel from './CartModel.js';
import CartItemService from './CartItemService.js';
import db from '../../db/knex.js';
import { makeArray } from '../../utils/utils.js';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

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

    /**
     * Creates a cart along with a random access token. Only the token's hash
     * is stored (token_hash is not part of the model schema, so it can never
     * be set or read through the generic CRUD handlers).
     *
     * @returns the cart with a one-time `cart_token` property
     */
    async createWithToken(data) {
        const token = crypto.randomBytes(32).toString('base64url');
        const payload = data ? this.prepareForUpsert(data) : {};
        delete payload.id;

        const results = await db
            .returning(this.model.getAllColumns())
            .insert({ ...payload, token_hash: hashToken(token) })
            .into(this.model.tableName);

        await this.addRelations(results);
        this.addVirtuals(results);

        return { ...results[0], cart_token: token };
    }


    /**
     * Checks a cart access token.
     *
     * @returns {Promise<{ exists: boolean, valid: boolean, closed: boolean, checkoutSessionId: string|null }>}
     */
    async checkToken(cartId, token) {
        const row = await db
            .select('token_hash', 'closed_at', 'stripe_order_id')
            .from(this.model.tableName)
            .where({ id: cartId })
            .whereNull('deleted_at')
            .first();

        if(!row) {
            return { exists: false, valid: false, closed: false };
        }

        let valid = false;

        if(row.token_hash && typeof token === 'string' && token) {
            const expected = Buffer.from(row.token_hash, 'hex');
            const actual = Buffer.from(hashToken(token), 'hex');
            valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
        }

        return { exists: true, valid, closed: !!row.closed_at, checkoutSessionId: row.stripe_order_id };
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
