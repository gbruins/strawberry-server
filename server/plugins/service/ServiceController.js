import BaseController from '../base/BaseController.js';
import ServiceService from './ServiceService.js';
import { buildState } from './ServiceState.js';

export default class ServiceController extends BaseController {

    constructor() {
        super(new ServiceService());
    }


    async nextHandler(request, h) {
        const state = await buildState();
        return h.apiSuccess(state);
    }

}
