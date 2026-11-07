import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { addProductType, createTestTenant, ownerQuery } from '../../../utils/testHelpers.js';
import { reserveCheckoutStock } from '../CheckoutService.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// A service's max_per_order (and its inventory) only limits products of the built-in Pizza
// type. Products of any other type can be ordered in any quantity.
describe('max_per_order only limits pizzas', () => {
    let server;
    let tenant;
    let pizza;
    let drink;
    let service;

    const authHeader = () => ({ Authorization: `Basic ${Buffer.from(`store:${tenant.apiKey}`).toString('base64')}` });

    async function createCart() {
        const res = await server.inject({ method: 'POST', url: '/api/v1/cart', headers: authHeader(), payload: {} });

        return { cartId: res.result.data.id, cartToken: res.result.data.cart_token };
    }

    function addItem({ cartId, cartToken }, product, qty) {
        return server.inject({
            method: 'POST',
            url: '/api/v1/cart/item',
            headers: { ...authHeader(), 'x-cart-token': cartToken },
            payload: { cart_id: cartId, product_id: product.id, qty }
        });
    }

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'Pizza limit test tenant', withApiKey: true });
        const drinkType = await addProductType(tenant.tenantId, { name: 'Drinks', slug: 'drinks' });

        [pizza, drink] = await ownerQuery('products').insert([
            { tenant_id: tenant.tenantId, title: 'Cheese', published: true, base_price: 1500, product_type: tenant.pizzaType },
            { tenant_id: tenant.tenantId, title: 'Soda', published: true, base_price: 300, product_type: drinkType }
        ]).returning('*');

        const [menu] = await ownerQuery('service_menus').insert({
            tenant_id: tenant.tenantId, title: 'Limit test menu', published: true
        }).returning('*');

        await ownerQuery('service_menu_products').insert([
            { tenant_id: tenant.tenantId, service_menu_id: menu.id, product_id: pizza.id, ordinal: 1 },
            { tenant_id: tenant.tenantId, service_menu_id: menu.id, product_id: drink.id, ordinal: 2 }
        ]);

        [service] = await ownerQuery('service').insert({
            tenant_id: tenant.tenantId,
            start_at: new Date(Date.now() - 60 * 60 * 1000),
            end_at: new Date(Date.now() + 60 * 60 * 1000),
            inventory_count: 50,
            max_per_order: 2,
            service_menu_id: menu.id
        }).returning('*');

        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await ownerQuery('cart_items').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('carts').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('service').where({ id: service.id }).del();
        await ownerQuery('service_menu_products').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('service_menus').where({ tenant_id: tenant.tenantId }).del();
        await tenant.cleanup();
        await server.stop();
    });

    it('allows more non-pizza products than max_per_order', { timeout: 15000 }, async () => {
        const cart = await createCart();
        const res = await addItem(cart, drink, 5);

        expect(res.statusCode).to.equal(200);
    });

    it('still rejects pizzas over max_per_order', { timeout: 15000 }, async () => {
        const cart = await createCart();

        expect((await addItem(cart, pizza, 2)).statusCode).to.equal(200);

        const res = await addItem(cart, pizza, 1);

        expect(res.statusCode).to.equal(409);
        expect(res.result.data.code).to.equal('over_limit');
        expect(res.result.data.max_per_order).to.equal(2);
    });

    it('does not count non-pizza products toward the pizza cap at checkout', { timeout: 15000 }, async () => {
        const cart = await createCart();

        expect((await addItem(cart, drink, 5)).statusCode).to.equal(200);
        expect((await addItem(cart, pizza, 2)).statusCode).to.equal(200);

        await reserveCheckoutStock(cart.cartId, {}, tenant.tenantId);

        const row = await ownerQuery('carts').where({ id: cart.cartId }).first('checkout_expires_at');
        expect(row.checkout_expires_at).to.exist();

        // Release the hold so later tests see the full inventory
        await ownerQuery('carts').where({ id: cart.cartId }).update({ checkout_expires_at: null });
    });

    it('marks only pizzas as limited on the public menu', { timeout: 15000 }, async () => {
        const res = await server.inject({ method: 'GET', url: '/api/v1/services/next', headers: authHeader() });

        expect(res.statusCode).to.equal(200);

        const byId = Object.fromEntries(res.result.data.menu.products.map((p) => [p.id, p]));
        expect(byId[pizza.id].limited).to.equal(true);
        expect(byId[drink.id].limited).to.equal(false);
        expect(byId[pizza.id].type_name).to.equal('Pizza');
        expect(byId[drink.id].type_name).to.equal('Drinks');
        expect(byId[drink.id].product_type).to.equal(drink.product_type);
    });
});
