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
                })
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
                })
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
                })
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
                })
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
                query: Joi.object({
                    ...controllerInstance.service.getValidationSchemaForId()
                })
            },
            handler: (request, h) => {
                return controllerInstance.deleteHandler(request, h);
            }
        }
    };

    return merge({}, base, overrides);
}
