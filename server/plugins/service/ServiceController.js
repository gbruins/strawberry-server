import BaseController from '../base/BaseController.js';
import ServiceService from './ServiceService.js';
import Boom from '@hapi/boom';
import { buildState } from './ServiceState.js';
import ServiceStream from './ServiceStream.js';
import { getClientIp } from '../../utils/clientIp.js';

export default class ServiceController extends BaseController {

    constructor() {
        super(new ServiceService());
    }


    async nextHandler(request, h) {
        const state = await buildState();
        return h.apiSuccess(state);
    }


    async streamHandler(request, h) {
        const ip = getClientIp(request);
        const stream = await ServiceStream.subscribe(ip);

        if(!stream) {
            throw Boom.tooManyRequests('Too many open streams');
        }

        request.raw.res.on('close', () => stream.destroy());

        return h.response(stream)
            .type('text/event-stream')
            .header('Cache-Control', 'no-cache')
            .header('Connection', 'keep-alive')
            .header('X-Accel-Buffering', 'no')
            .header('Content-Encoding', 'identity');
    }

}
