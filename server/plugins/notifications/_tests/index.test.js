import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { createTestTenant, suspendTenant, ownerQuery } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// T016 (specs/005-email-open-alerts/tasks.md): real sends against Postmark's own
// "POSTMARK_API_TEST" sandbox token — a real API call Postmark's backend recognizes as
// sandbox/test mode (accepted and processed normally, never actually delivered) — not a
// mocked client. This exercises the real NotificationService/Postmark integration code path,
// consistent with this project's established no-mocks testing practice (research.md #2's
// reasoning about why the send is awaited, not fire-and-forget, is what makes this testable at
// all — the response only arrives once the real send attempt has resolved one way or the other).
describe('POST /api/v1/services/notify', () => {
    let server;
    let tenant;
    let service;

    function adminAuth(tenantId) {
        return { strategy: 'adminBearer', credentials: { tenant_id: tenantId, role: 'owner', is_platform_staff: false } };
    }

    before({ timeout: 20000 }, async () => {
        process.env.POSTMARK_API_KEY = 'POSTMARK_API_TEST';
        process.env.EMAIL_INFO = 'test-sender@example.com';

        server = await init();
        tenant = await createTestTenant({ name: 'T016 test tenant' });

        [service] = await ownerQuery('service').insert({
            tenant_id: tenant.tenantId,
            start_at: new Date(Date.now() + 60 * 60 * 1000),
            end_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
            inventory_count: 50
        }).returning('*');

        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await ownerQuery('service').where({ tenant_id: tenant.tenantId }).del();
        await tenant.cleanup();
        await server.stop();
    });

    it('returns recipientCount: 0 and succeeds when there are no active subscribers', { timeout: 15000 }, async () => {
        const res = await server.inject({ method: 'POST', url: `/api/v1/services/notify?id=${service.id}`, auth: adminAuth(tenant.tenantId) });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.sent).to.equal(true);
        expect(res.result.data.recipientCount).to.equal(0);

        const sends = await ownerQuery('notification_sends').where({ service_id: service.id });
        expect(sends.length).to.equal(0); // a zero-recipient "send" writes no audit row at all
    });

    it('sends to every active subscriber and writes one notification_sends row, and resend adds a second', { timeout: 20000 }, async () => {
        await ownerQuery('email_subscribers').insert([
            { tenant_id: tenant.tenantId, email: 'sub1@example.com' },
            { tenant_id: tenant.tenantId, email: 'sub2@example.com' }
        ]);

        const first = await server.inject({ method: 'POST', url: `/api/v1/services/notify?id=${service.id}`, auth: adminAuth(tenant.tenantId) });
        expect(first.statusCode).to.equal(200);
        expect(first.result.data.recipientCount).to.equal(2);

        const sendsAfterFirst = await ownerQuery('notification_sends').where({ service_id: service.id });
        expect(sendsAfterFirst.length).to.equal(1);
        expect(sendsAfterFirst[0].recipient_count).to.equal(2);

        const second = await server.inject({ method: 'POST', url: `/api/v1/services/notify?id=${service.id}`, auth: adminAuth(tenant.tenantId) });
        expect(second.statusCode).to.equal(200);

        const sendsAfterSecond = await ownerQuery('notification_sends').where({ service_id: service.id });
        expect(sendsAfterSecond.length).to.equal(2); // resend, not deduped or blocked

        await ownerQuery('email_subscribers').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('notification_sends').where({ tenant_id: tenant.tenantId }).del();
    });

    it("surfaces last_notified_at on the service once notified, and excludes an unsubscribed address", { timeout: 20000 }, async () => {
        await ownerQuery('email_subscribers').insert([
            { tenant_id: tenant.tenantId, email: 'active@example.com' },
            { tenant_id: tenant.tenantId, email: 'gone@example.com', status: 'unsubscribed' }
        ]);

        const notifyRes = await server.inject({ method: 'POST', url: `/api/v1/services/notify?id=${service.id}`, auth: adminAuth(tenant.tenantId) });
        expect(notifyRes.result.data.recipientCount).to.equal(1); // only the active one

        const getRes = await server.inject({ method: 'GET', url: `/api/v1/service?id=${service.id}`, auth: adminAuth(tenant.tenantId) });
        expect(getRes.result.data.last_notified_at).to.exist();

        await ownerQuery('email_subscribers').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('notification_sends').where({ tenant_id: tenant.tenantId }).del();
    });

    it('rejects a notify attempt for a suspended tenant', { timeout: 15000 }, async () => {
        await suspendTenant(tenant.tenantId);

        const res = await server.inject({ method: 'POST', url: `/api/v1/services/notify?id=${service.id}`, auth: adminAuth(tenant.tenantId) });

        expect(res.statusCode).to.equal(403);

        await ownerQuery('tenants').where({ id: tenant.tenantId }).update({ status: 'active' });
    });

    it('writes no notification_sends row when the Postmark send itself fails', { timeout: 15000 }, async () => {
        await ownerQuery('email_subscribers').insert({ tenant_id: tenant.tenantId, email: 'wontget@example.com' });

        const originalKey = process.env.POSTMARK_API_KEY;
        process.env.POSTMARK_API_KEY = 'this-is-not-a-real-postmark-token';

        const res = await server.inject({ method: 'POST', url: `/api/v1/services/notify?id=${service.id}`, auth: adminAuth(tenant.tenantId) });

        process.env.POSTMARK_API_KEY = originalKey;

        expect(res.statusCode).to.equal(502);

        const sends = await ownerQuery('notification_sends').where({ service_id: service.id });
        expect(sends.length).to.equal(0);

        await ownerQuery('email_subscribers').where({ tenant_id: tenant.tenantId }).del();
    });

    // Found by independent QA review: a batch call that RESOLVES normally with every single
    // recipient individually rejected by Postmark (distinct from the API call itself throwing,
    // already covered above) was falling through to writing a notification_sends row and
    // returning recipientCount: 0 — indistinguishable from the genuine "no subscribers" case,
    // silently lying to staff that a send reaching nobody had succeeded.
    it('treats a total per-recipient failure the same as the send itself failing', { timeout: 15000 }, async () => {
        // Inserted directly (bypassing the app's own email format validation) specifically to
        // produce addresses Postmark's real API rejects per-recipient rather than up front.
        await ownerQuery('email_subscribers').insert([
            { tenant_id: tenant.tenantId, email: 'not-a-valid-address-1' },
            { tenant_id: tenant.tenantId, email: 'not-a-valid-address-2' }
        ]);

        const res = await server.inject({ method: 'POST', url: `/api/v1/services/notify?id=${service.id}`, auth: adminAuth(tenant.tenantId) });

        expect(res.statusCode).to.equal(502);

        const sends = await ownerQuery('notification_sends').where({ service_id: service.id });
        expect(sends.length).to.equal(0);

        await ownerQuery('email_subscribers').where({ tenant_id: tenant.tenantId }).del();
    });

    // Found by independent QA review: notifying about a service with no start_at scheduled
    // reached Postmark and produced a real, broken-looking email (the 1969 Unix epoch
    // formatted in the tenant's zone) sent to real subscribers.
    it('refuses to notify for a service with no scheduled start time', { timeout: 15000 }, async () => {
        const [draftService] = await ownerQuery('service').insert({
            tenant_id: tenant.tenantId,
            inventory_count: 10
            // start_at deliberately omitted
        }).returning('*');

        await ownerQuery('email_subscribers').insert({ tenant_id: tenant.tenantId, email: 'wouldhavegotten@example.com' });

        const res = await server.inject({ method: 'POST', url: `/api/v1/services/notify?id=${draftService.id}`, auth: adminAuth(tenant.tenantId) });

        expect(res.statusCode).to.equal(400);

        const sends = await ownerQuery('notification_sends').where({ service_id: draftService.id });
        expect(sends.length).to.equal(0);

        await ownerQuery('email_subscribers').where({ tenant_id: tenant.tenantId }).del();
        await ownerQuery('service').where({ id: draftService.id }).del();
    });
});
