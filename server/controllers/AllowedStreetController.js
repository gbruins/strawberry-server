import BaseController from './BaseController.js';
import AllowedStreetService from '../services/AllowedStreetService.js';

export default class AllowedStreetController extends BaseController {

    constructor() {
        super(new AllowedStreetService());
    }

}
