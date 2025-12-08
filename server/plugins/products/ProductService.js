import ProductModel from './ProductModel.js';
import BaseService from '../base/BaseService.js';

export default class ProductService extends BaseService {

    constructor() {
        super(new ProductModel());
    }

}
