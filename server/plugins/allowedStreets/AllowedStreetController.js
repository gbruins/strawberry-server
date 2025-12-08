import BaseController from '../base/BaseController.js';
import AllowedStreetService from './AllowedStreetService.js';

export default class AllowedStreetController extends BaseController {

    constructor() {
        super(new AllowedStreetService());
    }

}
