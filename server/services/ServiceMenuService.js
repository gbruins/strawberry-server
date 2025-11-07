import ServiceMenuModel from '../models/ServiceMenuModel.js';
import BaseService from './BaseService.js';

export default class ServiceMenuService extends BaseService {

    constructor() {
        super(new ServiceMenuModel());
    }

}
