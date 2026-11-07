import Boom from '@hapi/boom';
import ProductTypeModel from './ProductTypeModel.js';
import BaseService from '../base/BaseService.js';
import db from '../../db/knex.js';
import { isBuiltInSlug, nextTypeValue } from './builtInProductTypes.js';

export default class ProductTypeService extends BaseService {

    constructor() {
        super(new ProductTypeModel());
    }


    async addProductType(data, trx, tenantId) {
        await this.assertSlugAvailable(data.slug, null, trx);

        const allTypes = await super.search({ trx });

        data.value = nextTypeValue(allTypes.map((type) => type.value).filter((value) => value !== null));

        return super.upsertOne({
            data: data,
            trx,
            tenantId
        });
    }


    /**
     * Built-in types keep their slug, and no type may change its value: products point at
     * a type by its value, so changing it would orphan them.
     */
    async updateProductType(data, trx = db) {
        const current = await this.fetchOne({ where: { id: data.id }, trx });

        if(!current) {
            throw Boom.notFound();
        }

        if(data.value !== undefined && data.value !== current.value) {
            throw Boom.badRequest('A product type\'s value cannot be changed', { code: 'type_value_locked' });
        }

        if(data.slug !== undefined && data.slug !== current.slug) {
            if(isBuiltInSlug(current.slug)) {
                throw Boom.conflict(`The "${current.name}" product type is built in and its slug cannot be changed`, { code: 'built_in_type' });
            }

            await this.assertSlugAvailable(data.slug, current.id, trx);
        }

        return this.update({ data, where: { id: data.id }, trx });
    }


    /**
     * Built-in types, and types that products still use, cannot be deleted.
     */
    async assertCanDelete(id, trx = db) {
        const current = await this.fetchOne({ where: { id }, trx });

        if(!current) {
            throw Boom.notFound();
        }

        if(isBuiltInSlug(current.slug)) {
            throw Boom.conflict(`The "${current.name}" product type is built in and cannot be deleted`, { code: 'built_in_type' });
        }

        const inUse = await trx('products')
            .where({ product_type: current.value })
            .whereNull('deleted_at')
            .count({ count: '*' })
            .first();

        if(Number(inUse?.count) > 0) {
            throw Boom.conflict(`The "${current.name}" product type is used by products`, { code: 'type_in_use', count: Number(inUse.count) });
        }
    }


    async assertSlugAvailable(slug, exceptId, trx = db) {
        if(!slug) {
            return;
        }

        const qb = trx('product_types').where({ slug });

        if(exceptId) {
            qb.whereNot({ id: exceptId });
        }

        if(await qb.first('id')) {
            throw Boom.conflict(`A product type with the slug "${slug}" already exists`, { code: 'duplicate_slug' });
        }
    }


    addVirtuals(data) {
        const rows = Array.isArray(data) ? data : [data];

        rows.forEach((row) => {
            if(row) {
                row.built_in = isBuiltInSlug(row.slug);
            }
        });

        return data;
    }


    formatForUpsert(data) {
        if (data.metadata) {
            data.metadata = JSON.stringify(data.metadata)
        }

        return data;
    }


    getValidationSchemaForAdd() {
        const schema = { ...super.getValidationSchemaForAdd() };
        schema.name = schema.name.required();

        return schema;
    }

}
