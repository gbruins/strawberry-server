import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { addProductType, createTestTenant, ownerQuery } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// A product on a service's menu can be marked out of stock for that one service. It stays on
// the storefront menu (available: false) but can't be added to a cart or checked out.
describe('Per-service product availability', () => {
    let server;
    let tenant;
    let otherTenant;
    let pizza;
    let soda;
    let offMenu;
    let service;
    let laterService;

    const storeHeader = () => ({ Authorization: `Basic ${Buffer.from(`store:${tenant.apiKey}`).toString('base64')}` });
    const asOwner = (tenantId) => ({ strategy: 'adminBearer', credentials: { tenant_id: tenantId, role: 'owner', is_platform_staff: false } });

    async function createCart() {
        const res = await server.inject({ method: 'POST', url: '/api/v1/cart', headers: storeHeader(), payload: {} });

        return { cartId: res.result.data.id, cartToken: res.result.data.cart_token };
    }

    function addItem({ cartId, cartToken }, product, qty = 1) {
        return server.inject({
            method: 'POST',
            url: '/api/v1/cart/item',
            headers: { ...storeHeader(), 'x-cart-token': cartToken },
            payload: { cart_id: cartId, product_id: product.id, qty }
        });
    }

    function setUnavailable(serviceId, ids, tenantId = tenant.tenantId) {
        return server.inject({
            method: 'PUT',
            url: '/api/v1/service/availability',
            auth: asOwner(tenantId),
            payload: { id: serviceId, unavailable_product_ids: ids }
        });
    }

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'Availability test tenant', withApiKey: true });
        otherTenant = await createTestTenant({ name: 'Availability other tenant' });
        const drinkType = await addProductType(tenant.tenantId, { name: 'Drinks', slug: 'drinks' });

        [pizza, soda, offMenu] = await ownerQuery('products').insert([
            { tenant_id: tenant.tenantId, title: 'Cheese', published: true, base_price: 1500, product_type: tenant.pizzaType },
            { tenant_id: tenant.tenantId, title: 'Soda', published: true, base_price: 300, product_type: drinkType },
            { tenant_id: tenant.tenantId, title: 'Secret menu', published: true, base_price: 900, product_type: tenant.pizzaType }
        ]).returning('*');

        const [menu] = await ownerQuery('service_menus').insert({
            tenant_id: tenant.tenantId, title: 'Availability menu', published: true
        }).returning('*');

        await ownerQuery('service_menu_products').insert([
            { tenant_id: tenant.tenantId, service_menu_id: menu.id, product_id: pizza.id, ordinal: 1 },
            { tenant_id: tenant.tenantId, service_menu_id: menu.id, product_id: soda.id, ordinal: 2 }
        ]);

        [service, laterService] = await ownerQuery('service').insert([
            {
                tenant_id: tenant.tenantId,
                start_at: new Date(Date.now() - 60 * 60 * 1000),
                end_at: new Date(Date.now() + 60 * 60 * 1000),
                inventory_count: 50, max_per_order: 4, service_menu_id: menu.id
            },
            {
                tenant_id: tenant.tenantId,
                start_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
                end_at: new Date(Date.now() + 26 * 60 * 60 * 1000),
                inventory_count: 50, max_per_order: 4, service_menu_id: menu.id
            }
        ]).returning('*');

        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await ownerQuery('cart_items').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('carts').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('service_unavailable_products').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('service').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('service_menu_products').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('service_menus').where({ tenant_id: tenant.tenantId }).del();
        await tenant.cleanup();
        await otherTenant.cleanup();
        await server.stop();
    });

    it('lists the menu products, all in stock to begin with', async () => {
        const res = await server.inject({ method: 'GET', url: `/api/v1/service/availability?id=${service.id}`, auth: asOwner(tenant.tenantId) });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.map((p) => [p.title, p.available, p.limited])).to.equal([['Cheese', true, true], ['Soda', true, false]]);
    });

    it('refuses a product that is not on the service menu', { timeout: 15000 }, async () => {
        const res = await addItem(await createCart(), offMenu);

        expect(res.statusCode).to.equal(409);
        expect(res.result.data.code).to.equal('item_unavailable');
        expect(res.result.data.title).to.equal('Secret menu');
    });

    it('marks a product out of stock for one service only', { timeout: 15000 }, async () => {
        const cart = await createCart();
        expect((await addItem(cart, soda, 2)).statusCode).to.equal(200);

        const res = await setUnavailable(service.id, [soda.id]);
        expect(res.statusCode).to.equal(200);
        expect(res.result.data.find((p) => p.id === soda.id).available).to.equal(false);

        // The storefront still lists it, as not available
        const state = await server.inject({ method: 'GET', url: '/api/v1/services/next', headers: storeHeader() });
        const menuSoda = state.result.data.menu.products.find((p) => p.id === soda.id);
        expect(menuSoda.available).to.equal(false);
        expect(state.result.data.menu.products.find((p) => p.id === pizza.id).available).to.equal(true);

        // Can't add more, can't raise the quantity, but can lower it
        const fresh = await createCart();
        const add = await addItem(fresh, soda);
        expect(add.statusCode).to.equal(409);
        expect(add.result.data.code).to.equal('item_unavailable');

        const line = await ownerQuery('cart_items').where({ cart_id: cart.cartId }).first();
        const raise = await server.inject({
            method: 'PUT', url: '/api/v1/cart/item',
            headers: { ...storeHeader(), 'x-cart-token': cart.cartToken },
            payload: { id: line.id, qty: 3 }
        });
        expect(raise.statusCode).to.equal(409);

        const lower = await server.inject({
            method: 'PUT', url: '/api/v1/cart/item',
            headers: { ...storeHeader(), 'x-cart-token': cart.cartToken },
            payload: { id: line.id, qty: 1 }
        });
        expect(lower.statusCode).to.equal(200);

        // Checkout refuses the cart that still holds it (before any Stripe call)
        const checkout = await server.inject({
            method: 'POST', url: '/api/v1/cart/checkout',
            headers: { ...storeHeader(), 'x-cart-token': cart.cartToken },
            payload: { id: cart.cartId }
        });
        expect(checkout.statusCode).to.equal(409);
        expect(checkout.result.data.code).to.equal('item_unavailable');

        // The other service sharing the menu is unaffected
        const later = await server.inject({ method: 'GET', url: `/api/v1/service/availability?id=${laterService.id}`, auth: asOwner(tenant.tenantId) });
        expect(later.result.data.every((p) => p.available)).to.equal(true);
    });

    it('replaces the set, and back in stock means orderable again', { timeout: 15000 }, async () => {
        const res = await setUnavailable(service.id, []);
        expect(res.result.data.every((p) => p.available)).to.equal(true);

        expect((await addItem(await createCart(), soda)).statusCode).to.equal(200);
    });

    it('rejects products that are not on the menu', async () => {
        const res = await setUnavailable(service.id, [offMenu.id]);

        expect(res.statusCode).to.equal(400);
        expect(res.result.data.code).to.equal('not_on_menu');
    });

    it("another tenant can't read or change this service's stock", async () => {
        const read = await server.inject({ method: 'GET', url: `/api/v1/service/availability?id=${service.id}`, auth: asOwner(otherTenant.tenantId) });
        expect(read.statusCode).to.equal(404);

        const write = await setUnavailable(service.id, [soda.id], otherTenant.tenantId);
        expect(write.statusCode).to.equal(404);

        const rows = await ownerQuery('service_unavailable_products').where({ service_id: service.id });
        expect(rows).to.have.length(0);
    });
});
