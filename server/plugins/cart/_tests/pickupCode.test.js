import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { createTestTenant, getCart, ownerQuery } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';
import { completeCartFromSession } from '../CheckoutService.js';
import { allocatePickupCode } from '../PickupCodeService.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

function authHeader(apiKey) {
    return { Authorization: `Basic ${Buffer.from(`store:${apiKey}`).toString('base64')}` };
}

async function createCart(server, apiKey) {
    const res = await server.inject({ method: 'POST', url: '/api/v1/cart', headers: authHeader(apiKey), payload: {} });
    return res.result.data.id;
}

function paidSession(cartId, sessionId, { email = 'customer@example.com' } = {}) {
    return {
        id: sessionId,
        client_reference_id: cartId,
        payment_status: 'paid',
        customer_details: { email, name: 'Jane Doe', address: {} },
        amount_subtotal: 0,
        total_details: { amount_tax: 0 }
    };
}

// Pickup codes (3-digit, unique per tenant per day — see
// /Users/bruins/.claude/plans/lets-plan-a-new-distributed-key.md): completeCartFromSession must
// allocate them atomically alongside closed_at, be idempotent against Stripe's webhook retries,
// and never collide within one tenant's day, while two different tenants may freely reuse the
// same code on the same day since pickup only ever happens at one location.
describe('Pickup code allocation on checkout completion', () => {
    let server;
    let tenantA;
    let tenantB;

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenantA = await createTestTenant({ name: 'Pickup code test tenant A', withApiKey: true });
        tenantB = await createTestTenant({ name: 'Pickup code test tenant B', withApiKey: true });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenantA.cleanup();
        await tenantB.cleanup();
        await server.stop();
    });

    it('allocates sequential codes starting at 100 and persists the email Stripe collected', { timeout: 15000 }, async () => {
        const cart1 = await createCart(server, tenantA.apiKey);
        const cart2 = await createCart(server, tenantA.apiKey);

        const result1 = await completeCartFromSession(paidSession(cart1, 'cs_test_pickup_1', { email: 'first@example.com' }));
        expect(result1.handled).to.equal(true);

        const row1 = await getCart(cart1);
        expect(row1.pickup_code).to.equal(100);
        expect(row1.pickup_code_date).to.exist();
        expect(row1.billing_email).to.equal('first@example.com');

        const result2 = await completeCartFromSession(paidSession(cart2, 'cs_test_pickup_2', { email: 'second@example.com' }));
        expect(result2.handled).to.equal(true);

        const row2 = await getCart(cart2);
        expect(row2.pickup_code).to.equal(101);
        expect(row2.billing_email).to.equal('second@example.com');
    });

    it('is idempotent: replaying the same webhook event does not allocate a second code', { timeout: 15000 }, async () => {
        const cartId = await createCart(server, tenantA.apiKey);
        const session = paidSession(cartId, 'cs_test_pickup_replay');

        const first = await completeCartFromSession(session);
        expect(first.handled).to.equal(true);

        const afterFirst = await getCart(cartId);
        const codeAfterFirst = afterFirst.pickup_code;

        const second = await completeCartFromSession(session);
        expect(second.handled).to.equal(false);

        const afterSecond = await getCart(cartId);
        expect(afterSecond.pickup_code).to.equal(codeAfterFirst);
    });

    it('lets two different tenants reuse the same code on the same day', { timeout: 15000 }, async () => {
        const cartA = await createCart(server, tenantA.apiKey);
        const cartB = await createCart(server, tenantB.apiKey);

        await completeCartFromSession(paidSession(cartA, 'cs_test_pickup_tenant_a'));
        await completeCartFromSession(paidSession(cartB, 'cs_test_pickup_tenant_b'));

        const rowA = await getCart(cartA);
        const rowB = await getCart(cartB);

        // Tenant B has had no other orders yet today, so it starts its own sequence at 100
        // regardless of what tenant A's counter is already at — no cross-tenant collision check
        // is needed because pickup only ever happens at one store.
        expect(rowB.pickup_code).to.equal(100);
        expect(rowA.pickup_code).to.not.equal(undefined);
    });

    it('wraps back to 100 after 900 codes in one tenant-day, without erroring', { timeout: 10000 }, async () => {
        // ownerQuery bypasses RLS for direct fixture setup (same reasoning as every other test
        // in this project that seeds a tenant-scoped table outside a tenant-context transaction).
        await ownerQuery('tenant_pickup_counters')
            .insert({ tenant_id: tenantA.tenantId, counter_date: '2099-01-01', last_code: 900 })
            .onConflict(['tenant_id', 'counter_date'])
            .merge();

        // Unlike completeCartFromSession's own call (inside a transaction that already set the
        // tenant GUC), this test calls allocatePickupCode directly, so it sets that context itself.
        const { code } = await db.transaction(async (trx) => {
            await trx.raw('SELECT set_config(?, ?, true)', ['app.current_tenant_id', tenantA.tenantId]);
            return allocatePickupCode(tenantA.tenantId, 'America/Los_Angeles', trx, new Date('2099-01-01T12:00:00-08:00'));
        });

        expect(code).to.equal(100);

        await ownerQuery('tenant_pickup_counters').where({ tenant_id: tenantA.tenantId, counter_date: '2099-01-01' }).del();
    });
});
