import Boom from '@hapi/boom';
import db from '../../db/knex.js';
import BaseController from '../base/BaseController.js';
import EmailSubscriberService from './EmailSubscriberService.js';

export default class EmailSubscriberController extends BaseController {

    constructor() {
        super(new EmailSubscriberService());
    }

    /**
     * POST /subscribers (public, store API key) — always the same response shape whether the
     * email is new, already subscribed, or resubscribing (contracts/storefront-signup.md,
     * research.md #6). No distinction is exposed to the caller.
     */
    subscribeHandler = async (request, h) => {
        try {
            global.logger.info('REQUEST: EmailSubscriberController.subscribeHandler', {
                meta: request.payload
            });

            await this.service.subscribe({
                email: request.payload.email,
                trx: request.app.trx,
                tenantId: request.app.tenantId
            });

            return h.apiSuccess({ subscribed: true });
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }

    /**
     * GET /subscribers/count (admin) — a dedicated endpoint so the count is correct even
     * though the list itself is paginated (contracts/admin-subscribers.md).
     */
    countHandler = async (request, h) => {
        try {
            const [{ count }] = await request.app.trx('email_subscribers')
                .where({ status: 'subscribed' })
                .count('* as count');

            return h.apiSuccess({ activeCount: Number(count) });
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }

    /**
     * GET /subscribers/unsubscribe?token=... (public, auth: false) — a bare click from an
     * email client, no store key, no admin JWT, no tenant context at all. Always returns the
     * same response regardless of outcome (valid token, already-unsubscribed, or
     * unknown/malformed) — no information leak (contracts/storefront-signup.md,
     * data-model.md's validation rule). Runs on the owner connection via raw SQL, not
     * request.app.trx, since there is no RLS tenant context to set up for this route at all
     * (research.md #3) — unsubscribe_by_token() is SECURITY DEFINER specifically so this works.
     */
    unsubscribeHandler = async (request, h) => {
        try {
            await db.raw('SELECT unsubscribe_by_token(?)', [request.query.token]);
        }
        catch(err) {
            // A malformed (non-uuid) token throws at the SQL layer rather than returning false —
            // still no information leak, since this is caught and the response is identical.
            global.logger.error(err);
        }

        return h.apiSuccess({ unsubscribed: true });
    }

}
