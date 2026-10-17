import Joi from 'joi';
import BaseService from '../base/BaseService.js';
import CartService from './CartService.js';
import ProductService from '../products/ProductService.js';
import CartItemModel from './CartItemModel.js';
import db from '../../db/knex.js';
import { makeArray } from '../../utils/utils.js';
import Boom from '@hapi/boom';
import {
    getRemaining,
    getOpenService,
    countCartPizzas,
    isPizzaProduct,
    limitError
} from '../service/ServiceStock.js';

export default class CartItemService extends BaseService {

    constructor() {
        super(new CartItemModel());
    }



    /**
     * Makes sure the cart belongs to a service that is open right now, and that
     * the pizzas in the cart (with `newQty` of the given product) stay within the
     * per-order cap and the stock. Only pizzas are limited. Attaches the cart to
     * the open service on its first item.
     */
    async assertWithinLimits(cart, productId, newQty) {
        const now = new Date();
        let service;

        if(cart.service_id) {
            service = await db('service').where({ id: cart.service_id }).first();

            if(!service || new Date(service.start_at) > now || new Date(service.end_at) <= now) {
                throw limitError(Boom, 'no_open_service');
            }
        }
        else {
            service = await getOpenService(now);

            if(!service) {
                throw limitError(Boom, 'no_open_service');
            }
        }

        if(await isPizzaProduct(productId)) {
            const others = await countCartPizzas(cart.id, { excludeProductId: productId });
            const remaining = await getRemaining(service, { now, excludeCartId: cart.id });
            const cap = Math.min(service.max_per_order, remaining);

            if(others + newQty > cap) {
                throw limitError(Boom, 'over_limit', {
                    max_per_order: service.max_per_order,
                    remaining
                });
            }
        }

        if(!cart.service_id) {
            await db('carts').where({ id: cart.id }).update({ service_id: service.id, updated_at: db.fn.now() });
            cart.service_id = service.id;
        }
    }

    /**
     * Creates or updates a cart item in a cart
     *
     * @param {*} assertData  Must include the product_id of the product being added
     * @returns
     */
    async createCartItem(data) {
        global.logger.info('REQUEST: CartItemService.createCartItem', {
            meta: data
        });

        // NOTE: this.CartService can not be in the constructor
        // because it will result in an infinite loop because
        // CartItemService is in the constructor of CartService
        const CartSvc = new CartService();
        const ProductSvc = new ProductService();

        try {
            // Fetch or create the Cart
            const Cart = await CartSvc.getOrCreateCart(data.cart_id);
            if(!Cart) {
                throw new Error('Cart does not exist');
            }

            // Fetch the Product
            const Product = await ProductSvc.fetchOne({
                where: { id: data.product_id },
            });
            if(!Product) {
                throw new Error('Product does not exist');
            }

            // To prevent duplicate cart items being added to the cart:
            const existingCartItem = Array.isArray(Cart.cart_items)
                ? Cart.cart_items.find((CartItem) => CartItem.product?.id === Product.id)
                : null;

            // If a matching CartItem was found then we use it's ID
            // so the qty gets updated.  Otherwise a new CartItem will be created
            const quantity = parseInt(data.qty, 10);
            const newQty = existingCartItem?.qty ? parseInt(existingCartItem.qty, 10) + quantity : quantity;

            await this.assertWithinLimits(Cart, Product.id, newQty);

            return this.upsertOne({
                data: {
                    id: existingCartItem?.id || null,
                    qty: newQty,
                    cart_id: Cart.id,
                    product: Product
                }
            });
        }
        catch(err) {
            if(err.isBoom) {
                throw err;
            }

            console.error(err);
            throw new Error(err.message);
        }
    }


    /**
     * Update the qty of a CartItem
     *
     * @param {*} data
     * @returns
     */
    async updateCartItem(id, qty) {
        const CartItem = await this.fetchOne({
            where: { id }
        });

        if(!CartItem) {
            throw new Error('CartItem does not exist');
        }

        const newQty = parseInt(qty, 10);

        // Lowering a quantity is always allowed
        if(newQty > (CartItem.qty || 0)) {
            const cart = await db('carts').where({ id: CartItem.cart_id }).first();
            await this.assertWithinLimits(cart, CartItem.product?.id, newQty);
        }

        // Update the CartItem qty value
        return this.update({
            where: { id },
            data: { qty: newQty }
        });
    }


    /**
     * Adds variant relation to a list of carts
     *
     * @param {*} carts
     * @returns []
     */
    async addRelationToCarts(carts) {
        await this.setRelations(
            carts,
            'id',
            db.select(this.model.getAllColumns()).from(this.model.tableName).whereNull('deleted_at'),
            'cart_id',
            'cart_items'
        );

        // Show current prices and titles so the cart total matches what checkout charges.
        // A product that is gone keeps its stored snapshot; checkout refuses it.
        const productIds = [...new Set(
            makeArray(carts).flatMap((cart) => makeArray(cart.cart_items).map((item) => item.product?.id))
        )].filter(Boolean);

        if(productIds.length) {
            const current = await db('products')
                .select('id', 'title', 'base_price')
                .whereIn('id', productIds)
                .where('published', true)
                .whereNull('deleted_at');
            const byId = new Map(current.map((row) => [row.id, row]));

            makeArray(carts).forEach((cart) => {
                makeArray(cart.cart_items).forEach((item) => {
                    const row = byId.get(item.product?.id);

                    if(row) {
                        item.product = { ...item.product, title: row.title, base_price: row.base_price };
                    }
                });
            });
        }

        makeArray(carts).forEach((cart) => {
            this.addVirtuals(cart.cart_items);
        });

        return carts;
    }


    addVirtuals(data) {
        makeArray(data).forEach((cartItem) => {
            cartItem.price_subtotal = (function(obj) {
                let total = null;

                if(obj.qty) {
                    const basePrice = obj.product?.base_price;
                    total = basePrice ? basePrice * obj.qty : null;

                    // if(total !== null) {
                    //     total = accounting.toFixed(total, 2);
                    // }
                }

                return total;
            })(cartItem);
        });

        return data;
    }


    getValidationSchemaForAdd() {
        const schema = {
            ...super.getValidationSchemaForAdd()
        }

        delete schema.product
        schema.product_id = Joi.string().uuid().required();

        return schema;
    }


}
