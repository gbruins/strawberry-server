import Boom from '@hapi/boom';
import isObject from 'lodash.isobject';
import AuthService from '../services/AuthService.js';

const isProd = process.env.NODE_ENV === 'production';
const AuthSvc = new AuthService();

export const serverExtensionsPlugin = {
    name: 'serverExtensionsPlugin',
    version: '1.0.0',
    register: async function (server, options) {

        // Basic auth for store API usage
        server.auth.strategy('storeauth', 'basic', {
            validate: async (request, tenant_id, basic_auth_pwd) => {
                try {
                    const tenantData = await TenantSvc.basicAuthPasswordIsValid(tenant_id, basic_auth_pwd);

                    return {
                        isValid: tenantData ? true : false,
                        credentials: {
                            tenant_id: tenantData.id
                        }
                    }
                }
                catch(err) {
                    console.error(err);
                }
            }
        });


        // Session auth
        // CORS cookie notes:
        // * To set a cookie via CORS ajax requests, SameSite=None is required
        // * SameSite=None requires Secure to be true
        server.auth.strategy('adminCookie', 'cookie', {
            // https://hapi.dev/module/cookie/api/?v=11.0.1
            cookie: {
                name: 'sbsession',
                password: process.env.SESSION_COOKIE_PASSWORD,
                isSecure: true,
                isHttpOnly: true,
                isSameSite: 'None', // 'None' also requires isSecure=true
                domain: process.env.SESSION_COOKIE_DOMAIN,
                path: '/',
                // ttl: 3600000, // one hour
                // ttl: 60000, // one minute
                // ttl: process.env.SESSION_TTL,
                clearInvalid: true
            },
            // keepAlive: true,
            validate: async (request, session) => {
                global.logger.info('Cookie validate', {
                    meta: {
                        session_username: session.username
                    }
                });

                const isAuthorized = AuthSvc.isAuthorizedUser(session);

                if(!isAuthorized) {
                    global.logger.error('Cookie invalid because user does not exist', {
                        meta: {
                            session_username: session.username
                        }
                    });

                    return {
                        isValid: false
                    };
                }

                global.logger.info('Cookie validate success', {
                    meta: {
                        session_username: session.username,
                    }
                });

                return {
                    isValid: true,
                    credentials: {
                        username: session.username
                    }
                };
            }
        });


        server.auth.default('adminCookie');


        server.decorate('toolkit', 'apiSuccess', function (responseData) {
            const response = {};
            response.data = isObject(responseData) && responseData.hasOwnProperty('data')
                ? responseData.data
                : responseData;

            if(isObject(responseData) && responseData.hasOwnProperty('pagination')) {
                response.pagination = responseData.pagination;
            }

            return this.response(response);
        });


        // Updates the response output with a 'data' property if a data
        // property also exists in the Boom error
        server.ext('onPreResponse', (request, h) => {
            const response = request.response;

            if (!response.isBoom || !response.hasOwnProperty('output')) {
                return h.continue;
            }

            const is4xx = response.output.statusCode >= 400 && response.output.statusCode < 500;

            if (is4xx && response.data) {
                response.output.payload.data = response.data;
            }

            return h.continue;
        });
    }
};
