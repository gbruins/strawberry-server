import Joi from 'joi';
import AuthController from './AuthController.js';

const Ctrl = new AuthController();

export const authPlugin = {
    name: 'authPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        server.route([
            {
                method: 'POST',
                path: '/auth/login',
                options: {
                    description: 'Logs in a user',
                    auth: false,
                    validate: {
                        payload: Joi.object({
                            username: Joi.string().max(100),
                            password: Joi.string().max(100)
                        })
                    },
                    handler: (request, h) => {
                        return Ctrl.loginHandler(request, h);
                    }
                }
            },
            {
                method: 'POST',
                path: '/auth/logout',
                options: {
                    description: 'Logs out a user',
                    auth: false,
                    handler: (request, h) => {
                        return Ctrl.logoutHandler(request, h);
                    }
                }
            },
        ]);
    }
}
