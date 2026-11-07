import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { createTestTenant, suspendTenant, getCart } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';
import { completeCartFromSession } from '../CheckoutService.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// Pre-existing test, fixed while implementing specs/004-multi-tenant-supabase: was CommonJS
// `require()` in an ESM project (would never actually run), pointed at the wrong route path
// (`/product/tax_codes` instead of the real `/stripe/tax_codes`), and used a since-removed
// Basic-auth test-header helper. Stripe tax codes are a global Stripe list, not tenant data,
// so this needs no tenant-scoping — just a valid admin-authenticated request (via the same
// `server.inject({ auth })` override used in ../../auth/_tests and ../../products/_tests, for
// the same reason: no real Supabase project yet to sign a real JWT against).
describe('ROUTE: GET /stripe/tax_codes', () => {
    let server;

    before(async () => {
        server = await init();
    });

    after(async () => {
        await server.stop();
    });

    it('gets the list of Stripe tax codes', async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/api/v1/stripe/tax_codes',
            auth: {
                strategy: 'adminBearer',
                credentials: { tenant_id: null, role: 'owner', is_platform_staff: true }
            }
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.length).to.be.greaterThan(0);
        expect(res.result.data[0]).to.include('id');
        expect(res.result.data[0]).to.include('object');
        expect(res.result.data[0]).to.include('description');
        expect(res.result.data[0]).to.include('name');
    });
});


// Found by independent QA review of T035 (tasks.md): the suspended-tenant check in
// serverExtensions' onPreHandler never runs for the Stripe webhook (auth: false, no ambient
// trx), so a tenant suspended after a customer already reached Stripe's hosted Checkout page
// could still have completeCartFromSession() record a completed order. Fixed with the same
// check inside completeCartFromSession() itself, using the tenantId it already resolves via
// get_cart_tenant_id(). This test calls that function directly (not via the webhook route —
// there's no real Stripe signature to produce here), with a fabricated but shaped-correctly
// `session` object, same as Stripe's own `checkout.session.completed` payload shape.
describe('Checkout completion for a suspended tenant', () => {
    let server;
    let tenant;

    function authHeader(apiKey) {
        return { Authorization: `Basic ${Buffer.from(`store:${apiKey}`).toString('base64')}` };
    }

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'Suspended checkout test tenant', withApiKey: true });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenant.cleanup();
        await server.stop();
    });

    it('does not complete a paid session for a tenant suspended after Checkout was reached', { timeout: 15000 }, async () => {
        const createRes = await server.inject({
            method: 'POST',
            url: '/api/v1/cart',
            headers: authHeader(tenant.apiKey),
            payload: {}
        });

        expect(createRes.statusCode).to.equal(200);
        const cartId = createRes.result.data.id;

        await suspendTenant(tenant.tenantId);

        const result = await completeCartFromSession({
            id: 'cs_test_suspended',
            client_reference_id: cartId,
            payment_status: 'paid'
        });

        expect(result.handled).to.equal(false);

        const cart = await getCart(cartId);
        expect(cart.closed_at).to.not.exist();
    });
});


// T023 (tasks.md, FR-006): a cart token created under Tenant A is rejected when replayed
// against Tenant B — via the real apiKey Basic-auth path, same as T021/T022.
describe('Cart token cross-tenant rejection', () => {
    let server;
    let tenantA;
    let tenantB;

    function authHeader(apiKey) {
        return { Authorization: `Basic ${Buffer.from(`store:${apiKey}`).toString('base64')}` };
    }

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenantA = await createTestTenant({ name: 'T023 Tenant A', withApiKey: true });
        tenantB = await createTestTenant({ name: 'T023 Tenant B', withApiKey: true });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenantA.cleanup();
        await tenantB.cleanup();
        await server.stop();
    });

    it("rejects Tenant A's cart id + token when presented with Tenant B's API key", async () => {
        const createRes = await server.inject({
            method: 'POST',
            url: '/api/v1/cart',
            headers: authHeader(tenantA.apiKey),
            payload: {}
        });

        expect(createRes.statusCode).to.equal(200);
        const { id: cartId, cart_token: cartToken } = createRes.result.data;
        expect(cartId).to.exist();
        expect(cartToken).to.exist();

        // Same cart id + same token, but Tenant B's key — RLS means Tenant B's transaction
        // can't even see the row to compare the token against, so this must fail the same
        // way a nonexistent cart would (cartAccess.js: "Same response for a missing cart and
        // a bad token so cart IDs can't be probed").
        const crossTenantRes = await server.inject({
            method: 'GET',
            url: `/api/v1/cart?id=${cartId}`,
            headers: { ...authHeader(tenantB.apiKey), 'x-cart-token': cartToken }
        });

        expect(crossTenantRes.statusCode).to.equal(404);

        // Sanity check: the SAME id+token DOES work for the tenant that actually created it.
        const ownTenantRes = await server.inject({
            method: 'GET',
            url: `/api/v1/cart?id=${cartId}`,
            headers: { ...authHeader(tenantA.apiKey), 'x-cart-token': cartToken }
        });

        expect(ownTenantRes.statusCode).to.equal(200);
        expect(ownTenantRes.result.data.id).to.equal(cartId);
    });
});
