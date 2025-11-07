import AllowedStreetModel from '../models/AllowedStreetModel.js';
import BaseService from './BaseService.js';

export default class AllowedStreetService extends BaseService {

    constructor() {
        super(new AllowedStreetModel());
    }

}
