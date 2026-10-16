import Boom from '@hapi/boom';
import ProductService from './ProductService.js';

const ProductSvc = new ProductService();

const isAdmin = (request) => request.auth.strategy === 'adminCookie';

/**
 * Store (API key) callers only ever see published products in lists.
 * Admin sessions see everything.
 */
export function publishedOnlyForStore(request, h) {
    if(!isAdmin(request)) {
        request.query.published = true;
    }

    return h.continue;
}


/**
 * Store (API key) callers get a 404 for unpublished products fetched by ID.
 */
export async function publishedByIdForStore(request, h) {
    if(isAdmin(request)) {
        return h.continue;
    }

    const product = await ProductSvc.fetchOne({
        where: { id: request.query.id },
        fetchRelations: false
    });

    if(!product?.published) {
        throw Boom.notFound();
    }

    return h.continue;
}
