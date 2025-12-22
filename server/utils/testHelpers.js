require('dotenv').config();


function destroyKnexAndStopServer(server, done) {
    if(server.app.hasOwnProperty('knex')) {
        server.app.knex.destroy(() => {
            server.stop(done);
        });
    }
    else {
        server.stop(done);
    }
}


function getApiPrefix(path) {
    const prefix = '/api/v1';
    const suffix = path && path.charAt(0) === '/' ? path : '/' + path;

    if(path) {
        return `${prefix}${suffix}`;
    }

    return prefix;
}


function getRequestHeader() {
    const encodedToken = Buffer.from(`${process.env.TEST_TENANT_ID}:${process.env.TEST_TENANT_API_KEY}`).toString('base64');
    return {
        Authorization: `Basic ${encodedToken}`
    }
}


function getMockCart(numItems) {
    const mockCart = {
        billing_firstName: null,
        billing_lastName: null,
        billing_company: null,
        billing_streetAddress: null,
        billing_extendedAddress: null,
        billing_city: null,
        billing_state: null,
        billing_postalCode: null,
        billing_countryCodeAlpha2: null,
        billing_phone: null,
        billing_same_as_shipping: true,
        shipping_firstName: 'Tim',
        shipping_lastName: 'Tebow',
        shipping_streetAddress: '123 Abc St',
        shipping_extendedAddress: null,
        shipping_company: null,
        shipping_city: 'Denver',
        shipping_state: 'CO',
        shipping_postalCode: '11111',
        shipping_countryCodeAlpha2: 'US',
        shipping_phone: '867-5309',
        shipping_email: null,
        selected_shipping_rate: null,
        shipping_rate_quote: null,
        num_items: 3,
        sub_total: 3300,
        grand_total: 3300,
        weight_oz_total: 33,
        shipping_total: 0,
        cart_items: []
    };

    for(let i=0; i<(numItems || 1); i++) {
        mockCart.cart_items.push({
            id: i,
            qty: 1,
            product: {
                id: i,
                package_type: null,
                shippable: true,
                ship_alone: false,
                packing_length_cm: 40, // 15.7 inches
                packing_width_cm: 25, // 10 inches
                packing_height_cm: 3,  // just over 1 inch
                packing_volume_cm: 3000,
                customs_country_of_origin: null,
                customs_harmonized_system_code: null,
            },
            product_variant: {},
            product_variant_sku: {
                display_price: 1200,
                weight_oz: 12
            }
        })
    }

    return mockCart;
}


module.exports = {
    destroyKnexAndStopServer,
    getApiPrefix,
    getRequestHeader,
    getMockCart
}
