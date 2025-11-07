import BaseController from './BaseController.js';
import AddressDiscountService from '../services/AddressDiscountService.js';

export default class DiscountAddressController extends BaseController {
    constructor() {
        super(new AddressDiscountService());
    }
}
