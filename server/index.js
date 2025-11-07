
import dotenv from 'dotenv';
import Hapi from '@hapi/hapi';
import HapiCookie from '@hapi/cookie';
import HapiBasic from '@hapi/basic';
import { serverExtensionsPlugin } from './plugins/serverExtensionsPlugin.js';
import { apiPlugin } from './plugins/api/apiPlugin.js';
import { loggerPlugin } from './plugins/loggerPlugin.js';

dotenv.config();

const init = async () => {
    const server = Hapi.server({
        port: process.env.PORT || 3000,
        host: 'localhost'
    });

    // Register plugins here
    await server.register([HapiCookie, HapiBasic]);

    await server.register({
        plugin: apiPlugin,
        options: { /* your options */ },
        routes: {
            prefix: '/api/v1'
        }
    });

    await server.register(serverExtensionsPlugin);
    await server.register(loggerPlugin);

    server.route({
        method: 'GET',
        path: '/',
        handler: (request, h) => {
            return 'Hello, world!';
        }
    });

    await server.start();
    console.log('Server running on %s', server.info.uri);
};


process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});

init();
