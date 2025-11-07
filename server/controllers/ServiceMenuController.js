import BaseController from './BaseController.js';
import ServiceMenuService from '../services/ServiceMenuService.js';

export default class ServiceMenuController extends BaseController {

    constructor() {
        super(new ServiceMenuService());
    }

}
