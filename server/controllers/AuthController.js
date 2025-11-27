import Boom from '@hapi/boom';
import BaseController from './BaseController.js';
import AuthService from '../services/AuthService.js';

export default class AuthController extends BaseController {

    constructor() {
        super(new AuthService());
    }

    loginHandler(request, h) {
        global.logger.info('REQUEST: AuthController.loginHandler', {
            meta: {
                payload: request.payload
            }
        });

        try {
            this.service.login(
                request.payload.username,
                request.payload.password
            );
        }
        catch(err) {
            throw Boom.unauthorized();
        }

        try {
            this.service.setCookieOnRequest(request, request.payload.username);

            global.logger.info('RESPONSE: AuthController.loginHandler', {
                meta: {}
            });

            return h.apiSuccess({
                username: request.payload.username
            });
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }


    logoutHandler(request, h) {
        global.logger.info('REQUEST: AuthController.logoutHandler', {
            meta: {
                payload: request.payload
            }
        });

        try {
            this.service.removeCookieOnRequest(request);

            global.logger.info('RESPONSE: AuthController.logoutHandler', {
                meta: {}
            });

            return h.apiSuccess();
        }
        catch(err) {
            global.logger.error(err);
            throw Boom.badRequest(err);
        }
    }

}
