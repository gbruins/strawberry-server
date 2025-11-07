import BaseController from './BaseController.js';
import ServiceService from '../services/ServiceService.js';

export default class ServiceController extends BaseController {

    constructor() {
        super(new ServiceService());
    }

}
