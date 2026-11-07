import Boom from '@hapi/boom';
import { sendOpeningNotification } from './NotificationService.js';

export default class NotificationController {

    /**
     * POST /services/notify?id=... (admin) — staff's explicit, manual "Notify subscribers"
     * action (FR-005/FR-006). AWAITS the actual Postmark send (research.md #2 — not
     * fire-and-forget, unlike ServiceMenuController's publish() pattern): the
     * notification_sends audit row is only written after confirmed success, so FR-007's
     * "already notified" indicator never shows a send that didn't really happen. Zero active
     * subscribers is a normal 200 (FR-012), not an error.
     */
    notifyHandler = async (request, h) => {
        try {
            const trx = request.app.trx;
            const tenantId = request.app.tenantId;

            const service = await trx('service').where({ id: request.query.id }).first();

            if (!service) {
                throw Boom.notFound();
            }

            // Found by QA review: notifying about an opening with no scheduled start time would
            // otherwise reach Postmark and produce a real, broken-looking email ("...open
            // Wednesday, December 31 at 7:00 PM" — the 1969 Unix epoch formatted in the
            // tenant's zone) sent to real subscribers. There is nothing meaningful to tell them
            // for a service in this state.
            if (!service.start_at) {
                throw Boom.badRequest('This service has no scheduled start time to notify subscribers about');
            }

            const tenant = await trx('tenants').where({ id: tenantId }).first('name', 'timezone');

            const subscribers = await trx('email_subscribers')
                .where({ status: 'subscribed' })
                .select('email');

            const recipients = subscribers.map((s) => s.email);

            if (!recipients.length) {
                return h.apiSuccess({ sent: true, recipientCount: 0 });
            }

            let results;

            try {
                results = await sendOpeningNotification({ service, tenant, recipients });
            }
            catch (err) {
                global.logger.error(err);
                throw Boom.badGateway('Failed to send the notification — nothing was emailed, no record was kept');
            }

            const successCount = results.filter((r) => r.success).length;
            const failures = results.filter((r) => !r.success);

            // Found by QA review: a batch call that RESOLVES normally with every single
            // recipient individually rejected (e.g. a broadcast stream not yet approved, or
            // every address bouncing) never hit the catch below, so this fell through to
            // writing a notification_sends row and returning 200 with recipientCount: 0 —
            // indistinguishable from the genuine "no subscribers" case, silently lying to staff
            // that a send that reached nobody had succeeded. Only a send with at least one
            // real success writes the audit row; zero successes out of a non-empty recipient
            // list is treated the same as the API call itself throwing.
            if (successCount === 0) {
                global.logger.error('Notification send failed for every recipient', { meta: failures });
                throw Boom.badGateway('Failed to send the notification — nothing was emailed, no record was kept');
            }

            // Logged, not thrown: a PARTIAL failure (some recipients bounced/rejected, others
            // succeeded) still counts as a real send for the ones that succeeded.
            if (failures.length) {
                global.logger.error('Notification send had partial failures', { meta: failures });
            }

            await trx('notification_sends').insert({
                tenant_id: tenantId,
                service_id: service.id,
                recipient_count: successCount
            });

            return h.apiSuccess({ sent: true, recipientCount: successCount });
        }
        catch (err) {
            if (err.isBoom) {
                throw err;
            }

            global.logger.error(err);
            throw Boom.badImplementation();
        }
    }

}
