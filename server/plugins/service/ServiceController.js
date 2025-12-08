import BaseController from '../base/BaseController.js';
import ServiceService from './ServiceService.js';

export default class ServiceController extends BaseController {

    constructor() {
        super(new ServiceService());
    }

}
