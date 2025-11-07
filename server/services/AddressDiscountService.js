import AddressDiscountModel from '../models/AddressDiscountModel.js';
import BaseService from './BaseService.js';

export default class AddressDiscountService extends BaseService {
    constructor() {
        super(new AddressDiscountModel());
    }
}
