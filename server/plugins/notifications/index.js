import Joi from 'joi';
import NotificationController from './NotificationController.js';

export const notificationsPlugin = {
    name: 'notificationsPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        const Ctrl = new NotificationController();

        server.route([
            // No auth override — falls to the default-deny adminBearer strategy (US2).
            {
                method: 'POST',
                path: '/services/notify',
                options: {
                    description: 'Sends a "we\'re open" notification for one service window to every active subscriber',
                    validate: {
                        query: Joi.object({
                            id: Joi.string().uuid().required()
                        })
                    },
                    handler: Ctrl.notifyHandler
                }
            }
        ]);
    }
};
