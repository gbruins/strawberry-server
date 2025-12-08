import BaseController from '../base/BaseController.js';
import ProductService from './ProductService.js';

export default class ProductController extends BaseController {

    constructor() {
        super(new ProductService());
    }

}
