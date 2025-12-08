import AddressDiscountModel from './AddressDiscountModel.js';
import BaseService from '../base/BaseService.js';

export default class AddressDiscountService extends BaseService {
    constructor() {
        super(new AddressDiscountModel());
    }
}
