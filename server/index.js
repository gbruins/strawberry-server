
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import Boom from '@hapi/boom';
import Hapi from '@hapi/hapi';
import HapiCookie from '@hapi/cookie';
import HapiBasic from '@hapi/basic';
import HapiRateLimit from 'hapi-rate-limit';
import { serverExtensionsPlugin } from './plugins/serverExtensionsPlugin.js';
import { apiPlugin } from './plugins/api/apiPlugin.js';
import { loggerPlugin } from './plugins/loggerPlugin.js';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

const init = async () => {
    const serverOptions = {
        host: process.env.SERVER_HOST || '127.0.0.1',
        port: process.env.PORT || 10000,
        routes: {
            cors: {
                origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(url => url.trim()) : ['*'],
                credentials: true // set to true if you need cookies (session) from the browser
            },
            validate: {
                failAction: (request, h, err) => {
                    global.logger.error(err);

                    if (isProd) {
                        throw Boom.badRequest('Invalid request payload input');
                    }
                    else {
                        // During development, respond with the full error.
                        throw err;
                    }
                }
            }
        }
    };

    // Only enable TLS when running in development (local certs).
    if (!isProd) {
        serverOptions.tls = {
            key: fs.readFileSync(path.resolve('../strawberry.local+2-key.pem')),
            cert: fs.readFileSync(path.resolve('../strawberry.local+2.pem')),
        };
    }

    const server = Hapi.server(serverOptions);

    // Register plugins here
    await server.register([HapiCookie, HapiBasic]);

    // https://www.npmjs.com/package/hapi-rate-limit
    await server.register({
        plugin: HapiRateLimit,
        options: {
            enabled: true,
            userLimit: 300,
            pathLimit: 50
         }
    });

    await server.register({
        plugin: apiPlugin,
        options: { /* your options */ },
        routes: {
            prefix: '/api/v1'
        }
    });

    await server.register(serverExtensionsPlugin);
    await server.register(loggerPlugin);

    // server.route({
    //     method: 'GET',
    //     path: '/',
    //     handler: () => 'Hello, world!'
    // });

    await server.start();
    console.log('Server running on %s', server.info.uri);
};


process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});

init();
