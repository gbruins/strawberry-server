import ServiceModel from '../models/ServiceModel.js';
import BaseService from './BaseService.js';

export default class ServiceService extends BaseService {

    constructor() {
        super(new ServiceModel());
    }

}
