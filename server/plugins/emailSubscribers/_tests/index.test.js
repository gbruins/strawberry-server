import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { createTestTenant, ownerQuery } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// T008 (specs/005-email-open-alerts/tasks.md): the public signup endpoint, exercised with real
// per-tenant API keys (same convention as spec 004's T021-T023), not injected credentials.
describe('POST /api/v1/subscribers', () => {
    let server;
    let tenantA;
    let tenantB;

    function authHeader(apiKey) {
        return { Authorization: `Basic ${Buffer.from(`store:${apiKey}`).toString('base64')}` };
    }

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenantA = await createTestTenant({ name: 'T008 Tenant A', withApiKey: true });
        tenantB = await createTestTenant({ name: 'T008 Tenant B', withApiKey: true });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenantA.cleanup();
        await tenantB.cleanup();
        await server.stop();
    });

    it('subscribes a new email', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'POST',
            url: '/api/v1/subscribers',
            headers: authHeader(tenantA.apiKey),
            payload: { email: 'visitor@example.com' }
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.subscribed).to.equal(true);

        const row = await ownerQuery('email_subscribers').where({ tenant_id: tenantA.tenantId, email: 'visitor@example.com' }).first();
        expect(row).to.exist();
        expect(row.status).to.equal('subscribed');
    });

    it('is idempotent for a duplicate email — no second row, same response', { timeout: 15000 }, async () => {
        const payload = { email: 'duplicate@example.com' };

        const first = await server.inject({ method: 'POST', url: '/api/v1/subscribers', headers: authHeader(tenantA.apiKey), payload });
        expect(first.statusCode).to.equal(200);

        const second = await server.inject({ method: 'POST', url: '/api/v1/subscribers', headers: authHeader(tenantA.apiKey), payload });
        expect(second.statusCode).to.equal(200);
        expect(second.result.data.subscribed).to.equal(true);

        const rows = await ownerQuery('email_subscribers').where({ tenant_id: tenantA.tenantId, email: 'duplicate@example.com' });
        expect(rows.length).to.equal(1);
    });

    it('treats email matching case-insensitively as the same subscriber', { timeout: 15000 }, async () => {
        await server.inject({ method: 'POST', url: '/api/v1/subscribers', headers: authHeader(tenantA.apiKey), payload: { email: 'MixedCase@Example.com' } });
        await server.inject({ method: 'POST', url: '/api/v1/subscribers', headers: authHeader(tenantA.apiKey), payload: { email: 'mixedcase@example.com' } });

        const rows = await ownerQuery('email_subscribers').where({ tenant_id: tenantA.tenantId, email: 'mixedcase@example.com' });
        expect(rows.length).to.equal(1);
    });

    it('rejects a malformed email and writes nothing', { timeout: 15000 }, async () => {
        const res = await server.inject({
            method: 'POST',
            url: '/api/v1/subscribers',
            headers: authHeader(tenantA.apiKey),
            payload: { email: 'not-an-email' }
        });

        expect(res.statusCode).to.equal(400);

        const row = await ownerQuery('email_subscribers').where({ tenant_id: tenantA.tenantId, email: 'not-an-email' }).first();
        expect(row).to.not.exist();
    });

    it("never lets Tenant B's key affect or see Tenant A's subscribers", { timeout: 15000 }, async () => {
        await server.inject({ method: 'POST', url: '/api/v1/subscribers', headers: authHeader(tenantA.apiKey), payload: { email: 'tenant-a-only@example.com' } });

        await server.inject({ method: 'POST', url: '/api/v1/subscribers', headers: authHeader(tenantB.apiKey), payload: { email: 'tenant-a-only@example.com' } });

        const tenantARow = await ownerQuery('email_subscribers').where({ tenant_id: tenantA.tenantId, email: 'tenant-a-only@example.com' }).first();
        const tenantBRow = await ownerQuery('email_subscribers').where({ tenant_id: tenantB.tenantId, email: 'tenant-a-only@example.com' }).first();

        expect(tenantARow).to.exist();
        expect(tenantBRow).to.exist();
        expect(tenantARow.id).to.not.equal(tenantBRow.id);
    });
});


// T015 (tasks.md): admin subscriber list/count/remove — tenant-scoped, and manual removal is
// the same state transition as self-service unsubscribe (not a hard delete).
describe('Admin subscriber management', () => {
    let server;
    let tenantA;
    let tenantB;

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenantA = await createTestTenant({ name: 'T015 Tenant A', withApiKey: true });
        tenantB = await createTestTenant({ name: 'T015 Tenant B' });

        await ownerQuery('email_subscribers').insert([
            { tenant_id: tenantA.tenantId, email: 'a1@example.com' },
            { tenant_id: tenantA.tenantId, email: 'a2@example.com' },
            { tenant_id: tenantB.tenantId, email: 'b1@example.com' }
        ]);

        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenantA.cleanup();
        await tenantB.cleanup();
        await server.stop();
    });

    function adminAuth(tenantId) {
        return { strategy: 'adminBearer', credentials: { tenant_id: tenantId, role: 'owner', is_platform_staff: false } };
    }

    it('lists only the caller tenant\'s own subscribers', { timeout: 15000 }, async () => {
        const res = await server.inject({ method: 'GET', url: '/api/v1/subscribers', auth: adminAuth(tenantA.tenantId) });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.length).to.equal(2);
        expect(res.result.data.every((row) => row.email.startsWith('a'))).to.equal(true);
    });

    it('counts only active subscribers for the caller tenant', { timeout: 15000 }, async () => {
        const res = await server.inject({ method: 'GET', url: '/api/v1/subscribers/count', auth: adminAuth(tenantA.tenantId) });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.activeCount).to.equal(2);
    });

    it('removes a subscriber by unsubscribing, not hard-deleting — and it can resubscribe afterward', { timeout: 15000 }, async () => {
        const row = await ownerQuery('email_subscribers').where({ tenant_id: tenantA.tenantId, email: 'a1@example.com' }).first();

        const res = await server.inject({ method: 'DELETE', url: `/api/v1/subscriber?id=${row.id}`, auth: adminAuth(tenantA.tenantId) });
        expect(res.statusCode).to.equal(200);

        const afterRemoval = await ownerQuery('email_subscribers').where({ id: row.id }).first();
        expect(afterRemoval).to.exist();
        expect(afterRemoval.status).to.equal('unsubscribed');

        await server.inject({
            method: 'POST',
            url: '/api/v1/subscribers',
            headers: { Authorization: `Basic ${Buffer.from(`store:${tenantA.apiKey}`).toString('base64')}` },
            payload: { email: 'a1@example.com' }
        });

        const resubscribed = await ownerQuery('email_subscribers').where({ id: row.id }).first();
        expect(resubscribed.status).to.equal('subscribed');
        expect(resubscribed.id).to.equal(row.id); // same row — not a second one
    });

    it("never lets Tenant B's admin see or remove Tenant A's subscribers", { timeout: 15000 }, async () => {
        const row = await ownerQuery('email_subscribers').where({ tenant_id: tenantA.tenantId, email: 'a2@example.com' }).first();

        const listRes = await server.inject({ method: 'GET', url: '/api/v1/subscribers', auth: adminAuth(tenantB.tenantId) });
        expect(listRes.result.data.some((r) => r.id === row.id)).to.equal(false);

        // 400, not 404: BaseController.deleteHandler's throwIfNotFound() does throw a genuine
        // Boom.notFound() when RLS makes the row invisible (confirmed directly — its message is
        // "Not Found"), but the handler's own outer catch block re-wraps every caught error,
        // that one included, into Boom.badRequest() — a pre-existing characteristic of every
        // admin update/delete route built on BaseController, not something specific to this
        // plugin. The storefront's 404 convention (storeVisibility.js) is a different code path
        // that bypasses BaseController entirely.
        const deleteRes = await server.inject({ method: 'DELETE', url: `/api/v1/subscriber?id=${row.id}`, auth: adminAuth(tenantB.tenantId) });
        expect(deleteRes.statusCode).to.equal(400);

        const stillSubscribed = await ownerQuery('email_subscribers').where({ id: row.id }).first();
        expect(stillSubscribed.status).to.equal('subscribed');
    });
});


// T027 (tasks.md): the public unsubscribe route — no auth of any kind (research.md #3), always
// the same generic 200 response regardless of outcome (contracts/storefront-signup.md), so a
// malformed/unknown token can't be distinguished from a real one by a third party.
describe('GET /api/v1/subscribers/unsubscribe', () => {
    let server;
    let tenant;

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'T027 test tenant', withApiKey: true });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenant.cleanup();
        await server.stop();
    });

    it('returns 200 for a malformed (non-UUID) token, not a validation error', { timeout: 15000 }, async () => {
        const res = await server.inject({ method: 'GET', url: '/api/v1/subscribers/unsubscribe?token=not-a-uuid-at-all' });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.unsubscribed).to.equal(true);
    });

    it('returns 200 for a well-formed but unknown token', { timeout: 15000 }, async () => {
        const res = await server.inject({ method: 'GET', url: '/api/v1/subscribers/unsubscribe?token=11111111-1111-1111-1111-111111111111' });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.unsubscribed).to.equal(true);
    });

    // Found by independent QA review: token was Joi .required(), so a bare hit on the URL with
    // no token param at all (or an empty one) got a raw 400 instead of the documented "always
    // 200" response — same class of bug as the earlier .uuid() over-validation fix above.
    it('returns 200 for a missing or empty token, not a validation error', { timeout: 15000 }, async () => {
        const noToken = await server.inject({ method: 'GET', url: '/api/v1/subscribers/unsubscribe' });
        expect(noToken.statusCode).to.equal(200);
        expect(noToken.result.data.unsubscribed).to.equal(true);

        const emptyToken = await server.inject({ method: 'GET', url: '/api/v1/subscribers/unsubscribe?token=' });
        expect(emptyToken.statusCode).to.equal(200);
        expect(emptyToken.result.data.unsubscribed).to.equal(true);
    });

    it('unsubscribes a real token with no auth header at all, and clicking the same link again stays a no-op 200', { timeout: 15000 }, async () => {
        const [row] = await ownerQuery('email_subscribers').insert({ tenant_id: tenant.tenantId, email: 'realtoken@example.com' }).returning('*');

        const res = await server.inject({ method: 'GET', url: `/api/v1/subscribers/unsubscribe?token=${row.unsubscribe_token}` });
        expect(res.statusCode).to.equal(200);
        expect(res.result.data.unsubscribed).to.equal(true);

        const afterFirst = await ownerQuery('email_subscribers').where({ id: row.id }).first();
        expect(afterFirst.status).to.equal('unsubscribed');
        expect(afterFirst.unsubscribed_at).to.exist();

        // Same link clicked again — still 200, no error, no change.
        const again = await server.inject({ method: 'GET', url: `/api/v1/subscribers/unsubscribe?token=${row.unsubscribe_token}` });
        expect(again.statusCode).to.equal(200);
        expect(again.result.data.unsubscribed).to.equal(true);

        const afterSecond = await ownerQuery('email_subscribers').where({ id: row.id }).first();
        expect(afterSecond.status).to.equal('unsubscribed');

        await ownerQuery('email_subscribers').where({ id: row.id }).del();
    });

    it('keeps the original unsubscribe_token usable after the address resubscribes', { timeout: 15000 }, async () => {
        const [row] = await ownerQuery('email_subscribers').insert({ tenant_id: tenant.tenantId, email: 'resub-token@example.com' }).returning('*');
        const originalToken = row.unsubscribe_token;

        await server.inject({ method: 'GET', url: `/api/v1/subscribers/unsubscribe?token=${originalToken}` });

        await server.inject({
            method: 'POST',
            url: '/api/v1/subscribers',
            headers: { Authorization: `Basic ${Buffer.from(`store:${tenant.apiKey}`).toString('base64')}` },
            payload: { email: 'resub-token@example.com' }
        });

        const resubscribed = await ownerQuery('email_subscribers').where({ id: row.id }).first();
        expect(resubscribed.status).to.equal('subscribed');
        expect(resubscribed.unsubscribe_token).to.equal(originalToken); // token doesn't change on resubscribe

        const res = await server.inject({ method: 'GET', url: `/api/v1/subscribers/unsubscribe?token=${originalToken}` });
        expect(res.statusCode).to.equal(200);

        const afterUnsub = await ownerQuery('email_subscribers').where({ id: row.id }).first();
        expect(afterUnsub.status).to.equal('unsubscribed');

        await ownerQuery('email_subscribers').where({ id: row.id }).del();
    });
});
