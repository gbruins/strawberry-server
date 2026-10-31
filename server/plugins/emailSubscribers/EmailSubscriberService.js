import db from '../../db/knex.js';
import EmailSubscriberModel from './EmailSubscriberModel.js';
import BaseService from '../base/BaseService.js';

export default class EmailSubscriberService extends BaseService {

    constructor() {
        super(new EmailSubscriberModel());
    }

    /**
     * Subscribes an email for a tenant, or re-subscribes it if it was previously
     * unsubscribed — upsert on (tenant_id, lower(email)) rather than a plain insert, which
     * would violate the unique index on a duplicate (research.md #6, data-model.md). Both
     * "brand new" and "resubscribing" return the same row shape; the caller (the controller)
     * doesn't need to and shouldn't distinguish them in its response (contracts/storefront-
     * signup.md).
     */
    async subscribe({ email, trx, tenantId }) {
        const dbOrTrx = trx || db;
        const normalizedEmail = email.trim().toLowerCase();

        const result = await dbOrTrx.raw(`
            INSERT INTO email_subscribers (tenant_id, email)
            VALUES (?, ?)
            ON CONFLICT (tenant_id, lower(email))
            DO UPDATE SET status = 'subscribed', subscribed_at = now(), unsubscribed_at = null
            RETURNING *
        `, [tenantId, normalizedEmail]);

        return result.rows[0];
    }

    /**
     * Staff manually removing a subscriber (contracts/admin-subscribers.md) is the exact same
     * state transition as the public, self-service unsubscribe link — not a hard delete, and
     * not a separate code path, so a manually-removed address can resubscribe itself later the
     * normal way.
     */
    async del(config) {
        // A plain Date, not db.fn.now() — BaseService.update() logs the full config (including
        // data) before the query runs, and a Knex raw/fn.now() binding carries internal
        // client/connection references (active Timeout handles for keep-alive/idle timers) that
        // break that logging call's JSON serialization. Every other update() call site in this
        // codebase only ever puts plain primitives in `data` for exactly this reason.
        return this.update({
            ...config,
            data: { status: 'unsubscribed', unsubscribed_at: new Date() }
        });
    }
}
