import Boom from '@hapi/boom';
import BaseController from '../base/BaseController.js';
import ProductService from './ProductService.js';
import StripeService from '../stripe/StripeService.js';

export default class ProductController extends BaseController {

    constructor() {
        super(new ProductService());
    }


    /**
     * Handles creating a new Product
     * First creates the Product in our database, then creates it in Stripe
     *
     * @param {*} request
     * @param {*} h
     * @returns
     */
    createHandler = async (request, h) => {
        global.logger.info(`REQUEST: ProductController.createHandler`, {
            meta: request.payload
        });

        try {
            // Create the Product in our database first because
            // the product data is needed for the Stripe objects
            let Product = await this.service.create({
                data: request.payload
            });

            global.logger.info(`ProductController.createHandler - created product`, {
                meta: Product
            });

            // Create the Product in Stripe
            // https://docs.stripe.com/api/products/object?lang=node
            const StripeProduct = await StripeService.createProduct({
                name: Product.title,
                active: true,
                description: Product.description,
                tax_code: Product.stripe_tax_code,
                metadata: {
                    localProductId: Product.id
                }
            });

            global.logger.info(`ProductController.createHandler - created product in Stripe`, {
                meta: StripeProduct
            });

            // Create the Price in Stripe
            const StripePrice = await StripeService.createPrice({
                product: StripeProduct.id,
                unit_amount: Product.base_price,
                active: true,
                metadata: {
                    localProductId: Product.id
                }
            });

            global.logger.info(`ProductController.createHandler - created price in Stripe`, {
                meta: StripePrice
            });

            // Update our Product with the Stripe IDs
            const UpdatedProduct = await this.service.update({
                data: {
                    id: Product.id,
                    stripe_product_id: StripeProduct.id,
                    stripe_price_id: StripePrice.id
                },
                where: { id: Product.id }
            });

            global.logger.info(`RESPONSE: ProductController.updateHandler`, {
                meta: UpdatedProduct
            });

            return h.apiSuccess(UpdatedProduct);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    /**
     * Handles updating Product
     *
     * @param {*} request
     * @param {*} h
     * @returns
     */
    async updateHandler(request, h) {
        try {
            global.logger.info(`REQUEST: ProductController.updateHandler`, {
                meta: request.payload
            });

            const Product = await this.throwIfNotFound(request.payload.id);

            const UpdatedProduct = await this.service.update({
                data: request.payload,
                where: { id: request.payload.id }
            });

            // The stripe product needs to be updated if the title, description or stripe_tax_code changes
            if (Product.title !== UpdatedProduct.title
                || Product.description !== UpdatedProduct.description
                || Product.stripe_tax_code !== UpdatedProduct.stripe_tax_code) {

                const UpdatedStripeProduct = await StripeService.updateProduct(
                    UpdatedProduct.stripe_product_id,
                    {
                        name: UpdatedProduct.title,
                        description: UpdatedProduct.description,
                        tax_code: UpdatedProduct.stripe_tax_code
                    }
                );

                global.logger.info(`ProductController.updateHandler - UPDATED product in Stripe`, {
                    meta: UpdatedStripeProduct
                });
            }

            // If the price needs to be changed, we have to create a new Price in Stripe
            // and deactivate the old one (prices in Stripe ("unit_amount") are immutable)
            if (UpdatedProduct.stripe_price_id
                && UpdatedProduct.stripe_product_id
                && UpdatedProduct.base_price
                && (UpdatedProduct.base_price !== Product.base_price)) {

                // Deactivate the old Price in Stripe
                const DeactivatedStripePrice = await StripeService.updatePrice(
                    UpdatedProduct.stripe_price_id,
                    {
                        active: false
                    }
                );

                global.logger.info(`ProductController.updateHandler - DEACTIVATED price in Stripe`, {
                    meta: DeactivatedStripePrice
                });

                // Create the new Price in Stripe
                const NewStripePrice = await StripeService.createPrice({
                    product: UpdatedProduct.stripe_product_id,
                    unit_amount: UpdatedProduct.base_price,
                    active: true,
                    metadata: {
                        localProductId: UpdatedProduct.id
                    }
                });

                global.logger.info(`ProductController.updateHandler - CREATED new price in Stripe`, {
                    meta: NewStripePrice
                });

                // Update our Product with the new Stripe Price ID
                const UpdatedProductWithNewPrice = await this.service.update({
                    data: {
                        id: UpdatedProduct.id,
                        stripe_price_id: NewStripePrice.id
                    },
                    where: { id: UpdatedProduct.id }
                });

                global.logger.info(`RESPONSE: ProductController.updateHandler - UPDATED product with new Stripe price ID`, {
                    meta: UpdatedProductWithNewPrice
                });

                return h.apiSuccess(UpdatedProductWithNewPrice);
            }

            global.logger.info(`RESPONSE: ProductController.updateHandler`, {
                meta: UpdatedProduct
            });

            return h.apiSuccess(UpdatedProduct);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    async deleteHandler(request, h) {
        try {
            global.logger.info(`REQUEST: ProductController.deleteHandler`, {
                meta: request.query
            });

            const DeletedProduct = await this.service.del({
                where: { id: request.query.id }
            });

            // Note: We are not deleting the Product or Price in Stripe, just deactivating them
            // because stripe products can not be deleted if they have any associated prices

            // Deactivate the Stripe Product
            if (DeletedProduct.stripe_product_id) {
                const DeactivatedStripeProduct = await StripeService.updateProduct(
                    DeletedProduct.stripe_product_id,
                    {
                        active: false
                    }
                );

                global.logger.info(`ProductController.deleteHandler - DEACTIVATED product in Stripe`, {
                    meta: DeactivatedStripeProduct
                });
            }

            // Deactivate the Stripe Price
            if (DeletedProduct.stripe_price_id) {
                const DeactivatedStripePrice = await StripeService.updatePrice(
                    DeletedProduct.stripe_price_id,
                    {
                        active: false
                    }
                );

                global.logger.info(`ProductController.deleteHandler - DEACTIVATED price in Stripe`, {
                    meta: DeactivatedStripePrice
                });
            }

            global.logger.info(`RESPONSE: ProductController.deleteHandler`, {
                meta: DeletedProduct
            });

            return h.apiSuccess(DeletedProduct);
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }
}
