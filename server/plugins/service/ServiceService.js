import ServiceModel from './ServiceModel.js';
import BaseService from '../base/BaseService.js';

export default class ServiceService extends BaseService {

    constructor() {
        super(new ServiceModel());
    }

}
