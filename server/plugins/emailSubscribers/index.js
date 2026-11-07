import Joi from 'joi';
import EmailSubscriberController from './EmailSubscriberController.js';
import { getGenericConfig_SEARCH, getGenericConfig_DELETE } from '../../utils/routeUtils.js';

export const emailSubscribersPlugin = {
    name: 'emailSubscribersPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new EmailSubscriberController();

        server.route([
            // Public, store API key — same auth as /cart (US1, FR-001/FR-002/FR-003/FR-004).
            {
                method: 'POST',
                path: '/subscribers',
                options: {
                    description: 'Subscribes an email to this tenant\'s "shop open" alerts',
                    auth: { strategies: ['apiKey'] },
                    validate: {
                        payload: Joi.object({
                            email: Joi.string().email().max(255).required()
                        })
                    },
                    handler: Ctrl.subscribeHandler
                }
            },

            // Public, no auth at all — a bare click from an email client (US3, FR-008/FR-009).
            {
                method: 'GET',
                path: '/subscribers/unsubscribe',
                options: {
                    description: 'Unsubscribes the address matching this token',
                    auth: false,
                    validate: {
                        // Not .uuid(), and token is optional/allow('') rather than required() —
                        // a malformed, missing, or empty token must still reach
                        // unsubscribeHandler and get the same generic 200 as an
                        // unknown-but-valid-shaped one (contracts/storefront-signup.md, spec
                        // Acceptance Scenario 3.3). Found by QA review (twice): .uuid() rejected
                        // a malformed token with a 400 before the handler's own try/catch ever
                        // ran; required() did the same for a missing/empty one.
                        query: Joi.object({
                            token: Joi.string().max(255).allow('').optional()
                        })
                    },
                    handler: Ctrl.unsubscribeHandler
                }
            },

            // Everything below: no auth override, falls to the default-deny adminBearer
            // strategy (US2, FR-014/FR-015).
            getGenericConfig_SEARCH(Ctrl, { path: '/subscribers' }),
            {
                method: 'GET',
                path: '/subscribers/count',
                options: {
                    description: 'Counts this tenant\'s currently-active subscribers',
                    handler: Ctrl.countHandler
                }
            },
            getGenericConfig_DELETE(Ctrl, { path: '/subscriber' })
        ]);
    }
};
