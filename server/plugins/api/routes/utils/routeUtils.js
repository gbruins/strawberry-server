import merge from 'lodash.merge';
import Joi from 'joi';

export function getGenericConfig_SEARCH(controllerInstance, overrides = {}) {
    const base = {
        method: 'GET',
        options: {
            description: 'Gets a list of items',
            validate: {
                query: Joi.object({
                    ...controllerInstance.service.getValidationSchemaForSearch()
                }),
                failAction: (request, h, err) => {
                    console.log('Validation error:', err.message);
                    // throw err; // rethrow to preserve default behavior
                }
            },
            handler: (request, h) => {
                return controllerInstance.searchHandler(request, h);
            }
        }
    };

    return merge({}, base, overrides);
}

export function getGenericConfig_GET(controllerInstance, overrides = {}) {
    const base = {
        method: 'GET',
        options: {
            description: 'Gets an item by ID',
            validate: {
                query: Joi.object({
                    ...controllerInstance.service.getValidationSchemaForId()
                }),
                failAction: (request, h, err) => {
                    console.log('Validation error:', err.message);
                    // throw err; // rethrow to preserve default behavior
                }
            },
            handler: (request, h) => {
                return controllerInstance.getByIdHandler(request, h);
            }
        }
    };

    return merge({}, base, overrides);
}


export function getGenericConfig_POST(controllerInstance, overrides = {}) {
    const base = {
        method: 'POST',
        options: {
            description: 'Adds a new item',
            validate: {
                payload: Joi.object({
                    ...controllerInstance.service.getValidationSchemaForAdd()
                }),
                failAction: (request, h, err) => {
                    console.log('Validation error:', err.message);
                    // throw err; // rethrow to preserve default behavior
                }
            },
            handler: (request, h) => {
                return controllerInstance.createHandler(request, h);
            }
        }
    };

    return merge({}, base, overrides);
}


export function getGenericConfig_PUT(controllerInstance, overrides = {}) {
    const base = {
        method: 'PUT',
        options: {
            description: 'Updates an item',
            validate: {
                payload: Joi.object({
                    ...controllerInstance.service.getValidationSchemaForUpdate()
                }),
                failAction: (request, h, err) => {
                    console.log('Validation error:', err.message);
                    // throw err; // rethrow to preserve default behavior
                }
            },
            handler: (request, h) => {
                return controllerInstance.updateHandler(request, h);
            }
        }
    };

    return merge({}, base, overrides);
}


export function getGenericConfig_DELETE(controllerInstance, overrides = {}) {
    const base = {
        method: 'DELETE',
        options: {
            description: 'Deletes an item',
            validate: {
                payload: Joi.object({
                    ...controllerInstance.service.getValidationSchemaForId()
                }),
                failAction: (request, h, err) => {
                    console.log('Validation error:', err.message);
                    // throw err; // rethrow to preserve default behavior
                }
            },
            handler: (request, h) => {
                return controllerInstance.deleteHandler(request, h);
            }
        }
    };

    return merge({}, base, overrides);
}
