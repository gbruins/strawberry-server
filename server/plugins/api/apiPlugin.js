// import pkg from './package.json' assert { type: "json" };  // https://stackoverflow.com/a/70106896/2924415

// server extensions, decorations, auth strategies
// import serverExtensions from './serverExtensions.js';

// routes
// import cartRoutes from './routes/carts.js';
import addressDiscountRoutes from './routes/address_discounts.js';
import allowedStreetRoutes from './routes/allowed_streets.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import productTypeRoutes from './routes/product_types.js';
import serviceRoutes from './routes/service.js';
import serviceMenuRoutes from './routes/service_menus.js';

export const apiPlugin = {
    name: 'apiPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        server.dependency(
            [],
            function (server) {
                // serverExtensions(server);
                // cartRoutes(server);
                addressDiscountRoutes(server);
                allowedStreetRoutes(server);
                authRoutes(server);
                productRoutes(server);
                productTypeRoutes(server);
                serviceRoutes(server);
                serviceMenuRoutes(server);
            }
        );
    }
};
