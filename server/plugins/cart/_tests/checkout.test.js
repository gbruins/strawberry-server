import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { createTestTenant, ownerQuery } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// T-equivalent for switching /cart/checkout from a Stripe-hosted redirect to Stripe's Embedded
// Checkout: no test existed for this route at all before this change (confirmed by searching
// the repo). Hits the real Stripe test-mode API (STRIPE_SECRET_KEY in .env is a real sk_test_
// key), consistent with this project's no-mocks testing practice — same reasoning as the
// Postmark POSTMARK_API_TEST sandbox token used elsewhere.
//
// The cart's product is deliberately NOT a "pizza" product_type: ServiceStock.js's
// countCartPizzas() only counts products whose product_type joins to a product_types row with
// slug 'pizza', so a non-pizza product makes reserveCheckoutStock() skip its
// inventory/per-order-limit checks entirely (pizzas === 0), needing only an open service window
// to exist — the minimal fixture for exercising checkout session creation itself, which is what
// this file tests, not the stock-limit logic (already covered elsewhere).
describe('POST /api/v1/cart/checkout', () => {
    let server;
    let tenant;
    let product;
    let service;

    function authHeader(apiKey) {
        return { Authorization: `Basic ${Buffer.from(`store:${apiKey}`).toString('base64')}` };
    }

    async function createCartWithItem() {
        const cartRes = await server.inject({ method: 'POST', url: '/api/v1/cart', headers: authHeader(tenant.apiKey), payload: {} });
        const cartId = cartRes.result.data.id;
        const cartToken = cartRes.result.data.cart_token;

        await ownerQuery('cart_items').insert({
            tenant_id: tenant.tenantId,
            cart_id: cartId,
            qty: 1,
            product: { id: product.id, title: product.title, base_price: product.base_price }
        });

        return { cartId, cartToken };
    }

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'Embedded checkout test tenant', withApiKey: true });

        [product] = await ownerQuery('products').insert({
            tenant_id: tenant.tenantId,
            title: 'Test Pizza',
            published: true,
            base_price: 1500
        }).returning('*');

        const [menu] = await ownerQuery('service_menus').insert({
            tenant_id: tenant.tenantId,
            title: 'Checkout test menu',
            published: true
        }).returning('*');

        await ownerQuery('service_menu_products').insert({
            tenant_id: tenant.tenantId,
            service_menu_id: menu.id,
            product_id: product.id,
            ordinal: 1
        });

        [service] = await ownerQuery('service').insert({
            tenant_id: tenant.tenantId,
            start_at: new Date(Date.now() - 60 * 60 * 1000),
            end_at: new Date(Date.now() + 60 * 60 * 1000),
            inventory_count: 50,
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
        await ownerQuery('products').where({ id: product.id }).del();
        await tenant.cleanup();
        await server.stop();
    });

    it('creates a real embedded Checkout Session and returns a client_secret, not a url', { timeout: 20000 }, async () => {
        const { cartId, cartToken } = await createCartWithItem();

        const res = await server.inject({
            method: 'POST',
            url: '/api/v1/cart/checkout',
            headers: { ...authHeader(tenant.apiKey), 'x-cart-token': cartToken },
            payload: { id: cartId }
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.client_secret).to.exist();
        expect(typeof res.result.data.client_secret).to.equal('string');
        expect(res.result.data.url).to.not.exist();

        const cart = await ownerQuery('carts').where({ id: cartId }).first();
        expect(cart.stripe_order_id).to.startWith('cs_test_');
        expect(cart.checkout_expires_at).to.exist();
    });

    it('hands back the same session (same client_secret) when checkout is requested twice', { timeout: 20000 }, async () => {
        const { cartId, cartToken } = await createCartWithItem();
        const headers = { ...authHeader(tenant.apiKey), 'x-cart-token': cartToken };

        const first = await server.inject({ method: 'POST', url: '/api/v1/cart/checkout', headers, payload: { id: cartId } });
        const second = await server.inject({ method: 'POST', url: '/api/v1/cart/checkout', headers, payload: { id: cartId } });

        expect(first.statusCode).to.equal(200);
        expect(second.statusCode).to.equal(200);
        expect(second.result.data.client_secret).to.equal(first.result.data.client_secret);
    });

    // Exercises createCheckout's pg_advisory_xact_lock directly: two `server.inject()` calls
    // each open their own real transaction/connection (same as two separate server instances
    // would), so firing them together via Promise.all is genuine cross-connection DB
    // concurrency, not just two sequential in-process calls. Without the lock serializing them,
    // both could read the cart's stripe_order_id as null before either writes it and each
    // create its own Stripe session — a real double-session bug, not a hypothetical one.
    it('serializes two simultaneous checkout requests for the same cart into a single session', { timeout: 20000 }, async () => {
        const { cartId, cartToken } = await createCartWithItem();
        const headers = { ...authHeader(tenant.apiKey), 'x-cart-token': cartToken };

        const [first, second] = await Promise.all([
            server.inject({ method: 'POST', url: '/api/v1/cart/checkout', headers, payload: { id: cartId } }),
            server.inject({ method: 'POST', url: '/api/v1/cart/checkout', headers, payload: { id: cartId } })
        ]);

        expect(first.statusCode).to.equal(200);
        expect(second.statusCode).to.equal(200);
        expect(second.result.data.client_secret).to.equal(first.result.data.client_secret);

        const cart = await ownerQuery('carts').where({ id: cartId }).first();
        expect(cart.stripe_order_id).to.startWith('cs_test_');
    });
});
