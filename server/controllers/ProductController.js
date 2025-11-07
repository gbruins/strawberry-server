import BaseController from './BaseController.js';
import ProductService from '../services/ProductService.js';

export default class ProductController extends BaseController {

    constructor() {
        super(new ProductService());
    }

}
