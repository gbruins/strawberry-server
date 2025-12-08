import BaseController from '../base/BaseController.js';
import ServiceMenuService from './ServiceMenuService.js';

export default class ServiceMenuController extends BaseController {

    constructor() {
        super(new ServiceMenuService());
    }

}
