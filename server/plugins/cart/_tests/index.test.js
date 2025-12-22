const { expect } = require('@hapi/code');
const Lab = require('@hapi/lab');
const Hoek = require('@hapi/hoek');
const queryString = require('query-string');
const { afterEach, beforeEach, describe, it } = exports.lab = Lab.script();
const testHelpers = require('../../testHelpers');
const { init } = require('../../index.js');



describe('ROUTE: /product/tax_codes', () => {
    let server;

    beforeEach(async () => {
        server = await init();
    });

    afterEach(async () => {
        await server.stop();
    });


    it('should get the all stripe tax codes', async () => {
        const params = queryString.stringify({
            tenant_id: process.env.TEST_TENANT_ID
        });

        const res = await server.inject({
            method: 'GET',
            url: testHelpers.getApiPrefix(`/product/tax_codes?${params}`),
            headers: testHelpers.getRequestHeader()
        });

        expect(res.result.data.length).to.be.greaterThan(0);
        expect(res.result.data[0].hasOwnProperty('id')).to.equal(true);
        expect(res.result.data[0].hasOwnProperty('object')).to.equal(true);
        expect(res.result.data[0].hasOwnProperty('description')).to.equal(true);
        expect(res.result.data[0].hasOwnProperty('name')).to.equal(true);
    });
});
