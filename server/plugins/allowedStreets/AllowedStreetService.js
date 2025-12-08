import AllowedStreetModel from './AllowedStreetModel.js';
import BaseService from '../base/BaseService.js';

export default class AllowedStreetService extends BaseService {

    constructor() {
        super(new AllowedStreetModel());
    }

}
