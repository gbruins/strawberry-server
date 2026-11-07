
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import Boom from '@hapi/boom';
import Hapi from '@hapi/hapi';
import HapiBasic from '@hapi/basic';
import HapiRateLimit from 'hapi-rate-limit';
import { serverExtensionsPlugin } from './plugins/serverExtensions/index.js';
import { loggerPlugin } from './plugins/logger/index.js';
import { authPlugin } from './plugins/auth/index.js';
import { basePlugin } from './plugins/base/index.js';
import { cartPlugin } from './plugins/cart/index.js';
import { emailSubscribersPlugin } from './plugins/emailSubscribers/index.js';
import { kitchenPlugin } from './plugins/kitchen/index.js';
import { notificationsPlugin } from './plugins/notifications/index.js';
import { productPlugin } from './plugins/products/index.js';
import { productTypesPlugin } from './plugins/productTypes/index.js';
import { servicePlugin } from './plugins/service/index.js';
import { serviceMenuPlugin } from './plugins/serviceMenus/index.js';
import { stripePlugin } from './plugins/stripe/index.js';
import { tenantPlugin } from './plugins/tenant/index.js';
import { pickClientIp, trustedProxyHops } from './utils/clientIp.js';

dotenv.config();

// Builds and registers the server WITHOUT starting it (no `server.start()`, no port binding) —
// so tests can `server.inject()` requests directly against the route table (the standard Hapi
// testing pattern). The actual process entrypoint below calls `.start()` after this.
export async function init() {
    const isProd = process.env.NODE_ENV === 'production';
    const apiPrefix = '/api/v1';

    const serverOptions = {
        host: process.env.SERVER_HOST || '127.0.0.1',
        port: process.env.PORT || 10000,
        routes: {
            cors: {
                origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(url => url.trim()) : ['*'],
                additionalHeaders: ['x-cart-token', 'last-event-id'],
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
    // Set SERVER_TLS=false to serve plain HTTP.
    if (!isProd && process.env.SERVER_TLS !== 'false') {
        serverOptions.tls = {
            key: fs.readFileSync(path.resolve('../strawberry.local+2-key.pem')),
            cert: fs.readFileSync(path.resolve('../strawberry.local+2.pem')),
        };
    }

    const server = Hapi.server(serverOptions);

    // Register plugins here
    await server.register([HapiBasic]);
    await server.register(serverExtensionsPlugin);
    await server.register(loggerPlugin);

    // https://www.npmjs.com/package/hapi-rate-limit
    await server.register({
        plugin: HapiRateLimit,
        options: {
            enabled: true,
            userLimit: 300,
            // Behind a proxy the limiter must see the caller's address, not the proxy's
            trustProxy: trustedProxyHops() > 0,
            getIpFromProxyHeader: (header) => pickClientIp(header, undefined),
            // A per-path cap counts all callers together, so it would throttle legitimate
            // shoppers; sensitive routes set a per-caller userPathLimit instead.
            pathLimit: false
         }
    });

    await server.register({
        plugin: basePlugin,
        options: {}
    });

    await server.register({
        plugin: stripePlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: authPlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: cartPlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: emailSubscribersPlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: kitchenPlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: notificationsPlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: productPlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: productTypesPlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: servicePlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: serviceMenuPlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    await server.register({
        plugin: tenantPlugin,
        options: {},
        routes: {
            prefix: apiPrefix
        }
    });

    // server.dependency(
    //     [],
    //     function (server) {
    //         // serverExtensions(server);
    //         // cartRoutes(server);
    //         addressDiscountRoutes(server);
    //         allowedStreetRoutes(server);
    //         authRoutes(server);
    //         productRoutes(server);
    //         productTypeRoutes(server);
    //         serviceRoutes(server);
    //         serviceMenuRoutes(server);
    //     }
    // );

    // Required even for tests that only use server.inject() and never call .start(): several
    // plugins (hapi-rate-limit's internal catbox cache, at least) only connect their backing
    // cache on initialize(), not on registration — without this, inject() throws "Disconnected"
    // from deep inside hapi-rate-limit's authFailure handling, nothing to do with this
    // feature's own code. .start() below calls this too, but it's idempotent.
    await server.initialize();

    return server;
};

process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});

// Only start listening when this file is run directly (`node server/index.js`), not when
// `init` is imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
    const server = await init();
    await server.start();
    console.log('Server running on %s', server.info.uri);
}
