import { PassThrough } from 'node:stream';
import { buildState } from './ServiceState.js';

const HEARTBEAT_MS = 25000;
const TICK_MS = 3000;

/**
 * In-process hub that pushes the service state to every connected storefront.
 * A single server process is assumed; scaling out would need Postgres
 * LISTEN/NOTIFY to fan publish() calls out to the other processes.
 */
class ServiceStreamHub {

    constructor() {
        this.listeners = new Set();
        this.perIp = new Map();
        this.lastJson = null;
        this.eventId = 0;
        this.tickTimer = null;
        this.heartbeatTimer = null;
        this.publishing = false;
        this.publishAgain = false;
    }

    get maxPerIp() {
        return parseInt(process.env.SERVICE_STREAMS_PER_IP, 10) || 50;
    }

    get size() {
        return this.listeners.size;
    }

    /**
     * Registers a new stream and returns it, or null when the caller IP is
     * already at its connection limit.
     */
    async subscribe(ip, onClose) {
        const current = this.perIp.get(ip) || 0;
        if(current >= this.maxPerIp) {
            return null;
        }

        const stream = new PassThrough();
        const listener = { stream, ip };

        this.listeners.add(listener);
        this.perIp.set(ip, current + 1);
        this.startTimers();

        let closed = false;
        const close = () => {
            if(closed) {
                return;
            }
            closed = true;
            this.listeners.delete(listener);

            const remaining = (this.perIp.get(ip) || 1) - 1;
            if(remaining > 0) {
                this.perIp.set(ip, remaining);
            }
            else {
                this.perIp.delete(ip);
            }

            stream.destroy();
            this.stopTimersIfIdle();
            onClose?.();
        };

        stream.on('close', close);
        listener.close = close;

        // Every connection starts with a full state
        try {
            const state = await buildState();

            if(this.lastJson === null) {
                const { server_now, ...rest } = state;
                this.lastJson = JSON.stringify(rest);
            }

            stream.write(this.format(state));
        }
        catch(err) {
            global.logger?.error(err);
            close();
            throw err;
        }

        return stream;
    }

    format(state) {
        return `id: ${this.eventId}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`;
    }

    broadcast(chunk) {
        for(const { stream } of this.listeners) {
            stream.write(chunk);
        }
    }

    /**
     * Rebuilds the state and sends it to every listener if it changed.
     * Safe to call from any mutation; concurrent calls are coalesced.
     */
    async publish() {
        if(!this.listeners.size) {
            return;
        }

        if(this.publishing) {
            this.publishAgain = true;
            return;
        }

        this.publishing = true;
        try {
            do {
                this.publishAgain = false;
                const state = await buildState();
                // server_now changes every call, so compare without it
                const { server_now, ...rest } = state;
                const json = JSON.stringify(rest);

                if(json !== this.lastJson) {
                    this.lastJson = json;
                    this.eventId += 1;
                    this.broadcast(this.format(state));
                }
            } while(this.publishAgain);
        }
        catch(err) {
            global.logger?.error(err);
        }
        finally {
            this.publishing = false;
        }
    }

    startTimers() {
        if(!this.tickTimer) {
            this.tickTimer = setInterval(() => this.publish(), TICK_MS);
            this.tickTimer.unref();
        }

        if(!this.heartbeatTimer) {
            this.heartbeatTimer = setInterval(() => this.broadcast(': ping\n\n'), HEARTBEAT_MS);
            this.heartbeatTimer.unref();
        }
    }

    stopTimersIfIdle() {
        if(this.listeners.size) {
            return;
        }

        clearInterval(this.tickTimer);
        clearInterval(this.heartbeatTimer);
        this.tickTimer = null;
        this.heartbeatTimer = null;
        this.lastJson = null;
    }
}

const ServiceStream = new ServiceStreamHub();

export default ServiceStream;
