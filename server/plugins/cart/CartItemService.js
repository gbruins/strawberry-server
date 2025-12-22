import Joi from 'joi';
import BaseService from '../base/BaseService.js';
import CartService from './CartService.js';
import ProductService from '../products/ProductService.js';
import CartItemModel from './CartItemModel.js';
import db from '../../db/knex.js';
import { makeArray } from '../../utils/utils.js';

export default class CartItemService extends BaseService {

    constructor() {
        super(new CartItemModel());
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

            return this.upsertOne({
                data: {
                    id: existingCartItem?.id || null,
                    qty: existingCartItem?.qty ? parseInt(existingCartItem.qty, 10) + quantity : quantity,
                    cart_id: Cart.id,
                    product: Product
                }
            });
        }
        catch(err) {
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

        // Update the CartItem qty value
        return this.update({
            where: { id },
            data: { qty: parseInt(qty, 10) }
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
