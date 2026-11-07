import { expect } from '@hapi/code';
import Lab from '@hapi/lab';
import { init } from '../../../index.js';
import { addProductType, createTestTenant, ownerQuery } from '../../../utils/testHelpers.js';
import db from '../../../db/knex.js';

export const lab = Lab.script();
const { describe, it, before, after } = lab;

// Pizza is a built-in product type: the per-order cap and inventory only apply to it, so every
// tenant must have exactly one, it cannot be removed, and every product must have a real type.
describe('Built-in Pizza product type', () => {
    let server;
    let tenant;

    const auth = () => ({ strategy: 'adminBearer', credentials: { tenant_id: tenant.tenantId, role: 'owner', is_platform_staff: false } });

    const pizzaRow = () => ownerQuery('product_types').where({ tenant_id: tenant.tenantId, slug: 'pizza' }).first();

    before({ timeout: 20000 }, async () => {
        server = await init();
        tenant = await createTestTenant({ name: 'Built-in product type test tenant' });
        await db.raw('SELECT 1');
    });

    after({ timeout: 10000 }, async () => {
        await tenant.cleanup();
        await server.stop();
    });

    it('a new tenant has exactly one Pizza type, flagged as built in', async () => {
        const res = await server.inject({ method: 'GET', url: '/api/v1/product_types', auth: auth() });

        expect(res.statusCode).to.equal(200);

        const types = res.result.data;
        const pizzas = types.filter((type) => type.slug === 'pizza');
        expect(pizzas).to.have.length(1);
        expect(pizzas[0].built_in).to.equal(true);
    });

    it('cannot delete the Pizza type', async () => {
        const pizza = await pizzaRow();
        const res = await server.inject({ method: 'DELETE', url: `/api/v1/product_type?id=${pizza.id}`, auth: auth() });

        expect(res.statusCode).to.equal(409);
        expect(res.result.data.code).to.equal('built_in_type');
        expect(await pizzaRow()).to.exist();
    });

    it("cannot change the Pizza type's slug, but can rename it", async () => {
        const pizza = await pizzaRow();

        const slugRes = await server.inject({ method: 'PUT', url: '/api/v1/product_type', auth: auth(), payload: { id: pizza.id, slug: 'pies' } });
        expect(slugRes.statusCode).to.equal(409);
        expect(slugRes.result.data.code).to.equal('built_in_type');

        const nameRes = await server.inject({ method: 'PUT', url: '/api/v1/product_type', auth: auth(), payload: { id: pizza.id, name: 'Pies', slug: 'pizza' } });
        expect(nameRes.statusCode).to.equal(200);
        expect(nameRes.result.data.name).to.equal('Pies');
        expect(nameRes.result.data.slug).to.equal('pizza');
    });

    it("cannot change any type's value", async () => {
        const pizza = await pizzaRow();
        const res = await server.inject({ method: 'PUT', url: '/api/v1/product_type', auth: auth(), payload: { id: pizza.id, value: 64 } });

        expect(res.statusCode).to.equal(400);
    });

    it('rejects a second type with the same slug', async () => {
        const res = await server.inject({ method: 'POST', url: '/api/v1/product_type', auth: auth(), payload: { name: 'Pizza', slug: 'pizza' } });

        expect(res.statusCode).to.equal(409);
        expect(res.result.data.code).to.equal('duplicate_slug');
    });

    it('creates a new type with the next free value', async () => {
        const res = await server.inject({ method: 'POST', url: '/api/v1/product_type', auth: auth(), payload: { name: 'Sides', slug: 'sides' } });

        expect(res.statusCode).to.equal(200);
        expect(res.result.data.built_in).to.equal(false);
        expect(res.result.data.value).to.not.equal(tenant.pizzaType);
    });

    it('cannot delete a type that products use, but can delete an unused one', async () => {
        const value = await addProductType(tenant.tenantId, { name: 'Merch', slug: 'merch' });
        const type = await ownerQuery('product_types').where({ tenant_id: tenant.tenantId, value }).first();
        const [product] = await ownerQuery('products').insert({ tenant_id: tenant.tenantId, title: 'Shirt', published: true, product_type: value }).returning('*');

        const inUse = await server.inject({ method: 'DELETE', url: `/api/v1/product_type?id=${type.id}`, auth: auth() });
        expect(inUse.statusCode).to.equal(409);
        expect(inUse.result.data.code).to.equal('type_in_use');

        await ownerQuery('products').where({ id: product.id }).del();

        const unused = await server.inject({ method: 'DELETE', url: `/api/v1/product_type?id=${type.id}`, auth: auth() });
        expect(unused.statusCode).to.equal(200);
    });

    it('rejects a product without a product type', async () => {
        const res = await server.inject({ method: 'POST', url: '/api/v1/product', auth: auth(), payload: { title: 'Untyped', base_price: 100 } });

        expect(res.statusCode).to.equal(400);
    });

    it('rejects a product whose type does not exist', async () => {
        const res = await server.inject({ method: 'POST', url: '/api/v1/product', auth: auth(), payload: { title: 'Ghost', base_price: 100, product_type: 4096 } });

        expect(res.statusCode).to.equal(400);
        expect(res.result.data.code).to.equal('unknown_product_type');
    });
});
