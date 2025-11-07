import ProductModel from '../models/ProductModel.js';
import BaseService from './BaseService.js';

export default class ProductService extends BaseService {

    constructor() {
        super(new ProductModel());
    }

}
