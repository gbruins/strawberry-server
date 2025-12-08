import BaseController from '../base/BaseController.js';
import AddressDiscountService from './AddressDiscountService.js';

export default class AddressDiscountController extends BaseController {
    constructor() {
        super(new AddressDiscountService());
    }
}
