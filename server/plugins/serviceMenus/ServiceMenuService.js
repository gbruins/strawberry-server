import ServiceMenuModel from './ServiceMenuModel.js';
import BaseService from '../base/BaseService.js';

export default class ServiceMenuService extends BaseService {

    constructor() {
        super(new ServiceMenuModel());
    }

}
