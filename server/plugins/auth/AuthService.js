import bcrypt from 'bcryptjs';
import BaseService from '../base/BaseService.js';

export default class AuthService extends BaseService {

    constructor() {
        super();
    }


    setCookieOnRequest(request, username) {
        // This is the httpOnly cookie that is used by the server that is required for access.
        // cookieAuth is a decoration added by the Hapi "cookie" module to set a session cookie:
        // https://hapi.dev/module/cookie/api/?v=11.0.1
        // The cookie content (the object sent to cookieAuth.set) will be encrypted.
        request.cookieAuth.set({
            username: username
        });
    }


    removeCookieOnRequest(request) {
        request.cookieAuth.clear();
    }


    login(username, password) {
        if (!process.env.AUTH_USERNAME
            || !process.env.AUTH_PASSWORD
            || username !== process.env.AUTH_USERNAME
            || password !== process.env.AUTH_PASSWORD) {
            throw new Error('Unauthorized');
        }

        return true;
    }

    isAuthorizedUser(session) {
        console.log('isAuthorizedUser session:', session);
        return session && session.username === process.env.AUTH_USERNAME;
    }

    async apiKeyIsValid(userId, apiKey) {
        try {
            if (!userId || !apiKey) {
                global.logger.error('AuthService:apiKeyIsValid - FAILED');
                return false;
            }

            const apiKeyHash = process.env.API_KEY_HASH;
            const isValid = bcrypt.compareSync(apiKey, apiKeyHash);

            if(!isValid) {
                global.logger.error('AuthService:apiKeyIsValid - FAILED - basic auth password does not match hash', {
                    meta: {
                        apiKey: apiKey
                    }
                });
                return false;
            }

            // global.logger.info('RESPONSE: AuthService:apiKeyIsValid', {
            //     meta: {
            //         'API key is valid for user': userId
            //     }
            // });

            return userId;
        }
        catch(err) {
            console.log(err);
        }
    }

}
