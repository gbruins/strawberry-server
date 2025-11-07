import Joi from 'joi';
import { assert }from '@hapi/hoek';
import isObject from 'lodash.isobject';
import isString from 'lodash.isstring';
import { makeArray } from '../utils.js';
import db from '../db/knex.js';

const GERNERIC_ERROR_MSG = 'An error occurred while executing the DB operation.';

function assertWhere(config) {
    assert(isObject(config.where), new Error('config.where must be an object'));
}

function assertData(config) {
    assert(isObject(config.data), new Error('config.data must be an object'));
}


export default class BaseService {

    constructor(model) {
        this.model = model;
    }

    /**
    * Searches DB records
    *
    * Config: {
    *   where: optional
    *   data: N/A
    *   columns: optional
    *   orderBy: optional
    * }
    *
    * @example orderBy: ['id:DESC']
    * @example orderBy: ['id:DESC', 'foo:ASC']
    */
    async search(config = {}) {
        global.logger.info('REQUEST: BaseService.search', {
            meta: config
        });

        try {
            const qb = db
                .select(config.columns || this.model.getAllColumns())
                .from(this.model.tableName);

            if(config.where) {
                this.buildFilters(config.where, qb);
            }

            // Dont interfere with the deleted_at query if the user
            // has specified it in the config.where
            if(!config.where?.deleted_at && this.model.isSoftDelete()) {
                qb.whereNull('deleted_at')
            }

            // order by:
            // makeArray(config.orderBy).forEach((str) => {
            makeArray(config.where?._sort).forEach((str) => {
                const pair = str.split(':').map(val => val.trim());

                if(pair.length === 2
                    && ['asc', 'desc'].includes( pair[1].toLowerCase() )
                    && this.model.getAllColumns().includes(pair[0])) {
                        qb.orderBy(pair[0], pair[1].toLowerCase())
                }
            });

            const results = config.where?._pageSize || config.where?._page
                ? await qb.paginate({ perPage: config.where?._pageSize || 100, currentPage: config.where?._page || 1 })
                : await qb;

            if(config.fetchRelations !== false) {
                // Unpaginated results return an array
                // Paginated results return an object with 'data' and 'pagination' props
                await this.addRelations(
                    Array.isArray(results) ? results : (results?.data || [])
                );
            }

            this.addVirtuals(
                Array.isArray(results) ? results : (results?.data || [])
            );

            return results;
        }
        catch(err) {
            global.logger.error(err);
            throw new Error(GERNERIC_ERROR_MSG);
        }
    }


    /**
    * Gets one DB record
    *
    * Config: {
    *   where: optional
    *   data: N/A
    *   columns: optional
    * }
    */
    async fetchOne(config) {
        global.logger.info('REQUEST: BaseService.fetchOne', {
            meta: config
        });

        try {
            const qb = db
                .select(config.columns || this.model.getAllColumns())
                .from(this.model.tableName);

            if(config.where) {
                this.buildFilters(config.where, qb);
            }

            if(!config.where?.hasOwnProperty('deleted_at') && this.model.isSoftDelete()) {
                qb.whereNull('deleted_at')
            }

            const results = await qb.first();

            if(config.fetchRelations !== false) {
                await this.addRelations(results);
            }

            this.addVirtuals(results);

            return results;
        }
        catch(err) {
            console.error(err);
            throw new Error(GERNERIC_ERROR_MSG);
        }
    }


    /**
    * Creates a DB record
    *
    * Config: {
    *   where: N/A
    *   data: optional
    *   columns: optional
    * }
    *
    * NOTE: config.data is optional because I realized there is a use case
    * for only inserting the tenant_id in the row, which is when a new Cart is created.
    */
    async create(config) {
        global.logger.info('REQUEST: BaseService.create', {
            meta: config
        });

        try {
            const payload = config.data ? this.prepareForUpsert(config.data) : {};
            delete payload.id;

            // awaiting the reponse will cause errors to be caught
            // in the catch block.  Otherwise the errors will be returned,
            // which may lead DB query info
            const results = await db
                .returning(config.columns || this.model.getAllColumns())
                .insert(payload)
                .into(this.model.tableName);

            if(results && config.fetchRelations !== false) {
                await this.addRelations(results);
            }

            this.addVirtuals(results);

            return Array.isArray(config.data) ? results : results[0];
        }
        catch(err) {
            console.error(err);
            throw new Error(GERNERIC_ERROR_MSG);
        }
    }


    /**
    * Updates a DB record
    *
    * Config: {
    *   where: required
    *   data: required
    *   columns: optional
    * }
    */
    async update(config) {
        assertWhere(config);
        assertData(config);

        global.logger.info('REQUEST: BaseService.update', {
            meta: config
        });

        try {
            const payload = this.prepareForUpsert(config.data);
            delete payload.id;
            payload.updated_at = db.fn.now();

            const qb = db(this.model.tableName)
                .returning(config.columns || this.model.getAllColumns())
                .where(config.where);

            // Dont allow soft-deleted rows to be updated
            if(this.model.isSoftDelete()) {
                qb.whereNull('deleted_at')
            }

            const results = await qb.update(payload);

            if(results && config.fetchRelations !== false) {
                await this.addRelations(results);
            }

            this.addVirtuals(results);

            return Array.isArray(config.data) ? results : results[0];
        }
        catch(err) {
            global.logger.error(err);
            throw new Error(GERNERIC_ERROR_MSG);
        }
    }


    /**
     * Creates or Updates a DB record
     */
    upsertOne(config) {
        if(config.data?.id) {
            return this.update({
                ...config,
                where: {
                    id: config.data.id,
                    ...config.where
                }
            })
        }

        return this.create(config);
    }


    /*
    * Deletes a DB record
    * http://knexjs.org/#Builder-del%20/%20delete
    *
    * Config: {
    *   where: required
    *   columns: optional
    * }
    */
    async del(config) {
        assertWhere(config);

        global.logger.info('REQUEST: BaseService.del', {
            meta: config
        });

        try {
            const Model = await this.fetchOne(config);
            if(!Model) {
                throw new Error('Model does not exist');
            }

            const runDelete = async (trx) => {
                await this.deleteRelations(trx, Model.id);

                const qb = trx
                    .from(this.model.tableName)
                    .returning(config.columns || this.model.getAllColumns())
                    .where(config.where);

                const dbResponse = this.model.isSoftDelete()
                    ? await qb.whereNull('deleted_at').update({ deleted_at: db.fn.now() })
                    : await qb.del();

                return dbResponse?.[0] || {};
            }

            // If the given knex object is already a transaction then use it,
            // otherwise create a new transaction
            if(db.isTransaction) {
                return runDelete();
            }
            else {
                return db.transaction((trx) => {
                    return runDelete(trx);
                });
            }
        }
        catch(err) {
            global.logger.error(err);
            throw new Error(GERNERIC_ERROR_MSG);
        }
    }


    /*
    * This method is meant to be extended
    */
    addVirtuals(data) {
        return data;
    }


    /*
    * This method is meant to be extended
    */
    addRelations(results) {
        return results;
    }


    /*
    * This method is meant to be extended
    */
    deleteRelations(id) {
        return;
    }


    /**
     * This method is meant to be extended by any class
     * that has specific data formatting needs before DB insertion
     *
     * @param {*} data
     * @returns
     */
    formatForUpsert(data) {
        return data;
    }

    prepareForUpsert(data) {
        const doClean = (obj) => {
            const d = { ...this.formatForUpsert(obj) };
            delete d.created_at;
            delete d.updated_at;
            delete d.deleted_at;

            return d;
        }

        if(Array.isArray(data)) {
            return data.map((obj) => doClean(obj));
        }

        return doClean(data);
    }


    /**
     * For every parentResult, find all relations
     *
     * @param {*} parentResults
     * @param {*} childQuery
     * @param {*} parentResultKey
     * @param {*} childResultKey
     * @param {*} relationName
     *
     * @returns []
     */
    async setRelations(parentResults, parentResultKey, childQuery, childResultKey, relationName, oneToOne = false) {
        const whereInSet = new Set();  // use a Set so dupes are not collected
        const data = makeArray(parentResults)

        data.forEach(result => {
            if(result.hasOwnProperty(parentResultKey) && result[parentResultKey] !== null) {
                whereInSet.add( result[parentResultKey] );
            }
        });

        const relations = await childQuery.whereIn(childResultKey, Array.from(whereInSet));

        data.map((row) => {
            const filteredRelations = relations.filter((r) => r[childResultKey] === row[parentResultKey]);
            row[relationName] = oneToOne
                ? (filteredRelations?.[0] || null)
                : filteredRelations;

            return row;
        });

        return data;
    }


    /**
     * This pattern was inspired by: https://strapi.oschina.io/documentation/v3.x/content-api/parameters.html#available-operators
     * Knex query builder cheat sheet:  https://devhints.io/knex
     *
     * No suffix or eq: Equals
     * ne: Not equals
     * lt: Less than
     * gt: Greater than
     * lte: Less than or equal to
     * gte: Greater than or equal to
     * in: Included in an array of values
     * nin: Isn't included in an array of values
     * like: %like%
     * null: Is null/Is not null
     *
     * @example query values:
     * { 'id': { 'ne': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } }
     * { 'id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } => same as 'eq'
     * { 'closed_at': { 'null' : false } }  => 'closed_at is not null'
     * { 'closed_at': { 'null' : true } }  => 'closed_at is null'
     * { 'sub_type': { 'bitwise_and_gt': {'left':2, 'right':0} } }
     *
     *
     * https://knexjs.org/#Builder-wheres
     */
    buildFilters(query, qb) {
        if(!query) {
            return;
        }

        if(isObject(query)) {
            for(let key in query) {
                const orig = query[key];

                try {
                    if(isString(query[key])) {
                        query[key] = JSON.parse(query[key]);
                    }
                }
                catch(err) {
                    query[key] = orig
                }
            }
        }

        const operators = {
            eq: 'eq',
            ne: 'ne',
            lt: 'lt',
            gt: 'gt',
            lte: 'lte',
            gte: 'gte',
            in: 'in',
            nin: 'nin',
            like: 'like',
            null: 'null',
            bitwise_and_gt: 'bitwise_and_gt'
        }

        let whereUsed = false;

        const addWhere = (prop, operator, value) => {
            if(!whereUsed) {
                qb.where(prop, operator, value);
                whereUsed = true;
            }
            else {
                qb.andWhere(prop, operator, value);
            }
        }

        const trimArray = (arr) => {
            const clean = [];

            arr.forEach((item) => {
                const trimmed = item.trim();
                if(trimmed) {
                    clean.push(trimmed)
                }
            });

            return clean;
        }

        const blacklist = [
            '_pageSize',
            '_page',
            '_sort',
            '_withRelated'
        ];

        for(let prop in query) {
            let operator = operators.eq;
            let propValue = query[prop];

            // an operator modifier is an object
            // with only one key, which is one of the
            // keys in 'operators'
            if(isObject(query[prop])) {
                const keys = Object.keys(query[prop]);

                if(keys.length === 1 && operators.hasOwnProperty(keys[0])) {
                    operator = keys[0];
                    propValue = query[prop][operator];
                }
            }

            if(!blacklist.includes(prop)) {
                switch(operator) {
                    case operators.eq:
                        addWhere(prop, '=', propValue)
                        break;

                    case operators.ne:
                        addWhere(prop, '!=', propValue)
                        break;

                    case operators.lt:
                        addWhere(prop, '<', propValue)
                        break;

                    case operators.gt:
                        addWhere(prop, '>', propValue)
                        break;

                    case operators.lte:
                        addWhere(prop, '<=', propValue)
                        break;

                    case operators.gte:
                        addWhere(prop, '>=', propValue)
                        break;

                    case operators.in:
                        qb.whereIn(prop, trimArray(propValue));
                        break;

                    case operators.nin:
                        qb.whereNotIn(prop, trimArray(propValue));
                        break;

                    case operators.like:
                        addWhere(prop, 'LIKE', propValue);
                        break;

                    case operators.null:
                        if(propValue === 'true' || propValue === true) {
                            qb.whereNull(prop);
                        }
                        else {
                            qb.whereNotNull(prop);
                        }
                        break;

                    case operators.bitwise_and_gt:
                        // qb.whereRaw(`${prop} & ? > 0`, [propValue])
                        qb.whereRaw(`${prop} & ? > ${parseFloat(propValue.right)}`, [propValue.left])
                        break;

                    case operators.jsonb:
                        qb.whereRaw(`?? @> ?::jsonb`, [
                            prop,
                            (isObject(propValue) || Array.isArray(propValue) ? JSON.stringify(propValue) : propValue)
                        ])
                        break;
                }
            }
        }
    }


    getValidationSchemaForUpdate() {
        const schemaCopy = { ...this.model.schema };
        schemaCopy.id = schemaCopy.id.required();

        delete schemaCopy.created_at;
        delete schemaCopy.updated_at;
        delete schemaCopy.deleted_at;
        return schemaCopy;
    }


    getValidationSchemaForAdd() {
        const schemaCopy = { ...this.model.schema };

        delete schemaCopy.id;
        delete schemaCopy.created_at;
        delete schemaCopy.updated_at;
        delete schemaCopy.deleted_at;

        return schemaCopy;
    }


    getValidationSchemaForSearch() {
        const schemaCopy = {
            ...this.model.schema,
            ...this.getValidationSchemaForPagination()
        };
        delete schemaCopy.deleted_at;
        return schemaCopy;
    }


    getValidationSchemaForId() {
        return {
            id: Joi.string().uuid().required()
        }
    }


    getValidationSchemaForPagination() {
        return {
            _sort: Joi.string().max(50),

            _pageSize: Joi.alternatives().try(
                Joi.number().integer().min(0),
                Joi.string().max(5)
            ),

            _page: Joi.alternatives().try(
                Joi.number().integer().min(0),
                Joi.string().max(5)
            )
        };
    }


    getValidationSchemaForUpdateOrdinals() {
        return {
            ordinals: Joi.alternatives().try(
                Joi.array().items(
                    Joi.object().keys({
                        ...this.getValidationSchemaForId(),
                        ordinal: Joi.number().integer().required()
                    })
                ),
                Joi.string().trim()
            )
        }
    }

}
