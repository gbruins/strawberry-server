import { PassThrough } from 'node:stream';
import { buildStateForTenant } from './ServiceState.js';

const HEARTBEAT_MS = 25000;
const TICK_MS = 3000;

/**
 * In-process hub that pushes the service state to every connected storefront.
 * A single server process is assumed; scaling out would need Postgres
 * LISTEN/NOTIFY to fan publish() calls out to the other processes.
 *
 * Tenant-aware per listener (specs/004-multi-tenant-supabase): each connection is tagged with
 * the tenant it belongs to, and state/dedup tracking (`lastJsonByTenant`/`eventIdByTenant`) is
 * keyed per tenant, so one tenant's update is never broadcast to another's listeners. Making
 * this hub itself horizontally scale across tenants/processes (Postgres LISTEN/NOTIFY) remains
 * explicitly out of scope (research.md #6) — this only fixes it from "broken under RLS with no
 * tenant context" to "correct for however many tenants happen to share this one process".
 */
class ServiceStreamHub {

    constructor() {
        this.listeners = new Set();
        this.perIp = new Map();
        this.lastJsonByTenant = new Map();
        this.eventIdByTenant = new Map();
        this.tickTimer = null;
        this.heartbeatTimer = null;
        this.publishingTenants = new Set();
        this.publishAgainTenants = new Set();
    }

    get maxPerIp() {
        return parseInt(process.env.SERVICE_STREAMS_PER_IP, 10) || 50;
    }

    get size() {
        return this.listeners.size;
    }

    /**
     * Registers a new stream for the given tenant and returns it, or null when the caller IP
     * is already at its connection limit.
     */
    async subscribe(ip, onClose, tenantId) {
        const current = this.perIp.get(ip) || 0;
        if(current >= this.maxPerIp) {
            return null;
        }

        const stream = new PassThrough();
        const listener = { stream, ip, tenantId };

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
            const state = await buildStateForTenant(tenantId);

            if(!this.lastJsonByTenant.has(tenantId)) {
                const { server_now, ...rest } = state;
                this.lastJsonByTenant.set(tenantId, JSON.stringify(rest));
                this.eventIdByTenant.set(tenantId, 0);
            }

            stream.write(this.format(state, this.eventIdByTenant.get(tenantId)));
        }
        catch(err) {
            global.logger?.error(err);
            close();
            throw err;
        }

        return stream;
    }

    format(state, eventId) {
        return `id: ${eventId}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`;
    }

    broadcast(chunk, tenantId) {
        for(const listener of this.listeners) {
            if(listener.tenantId === tenantId) {
                listener.stream.write(chunk);
            }
        }
    }

    broadcastToAll(chunk) {
        for(const { stream } of this.listeners) {
            stream.write(chunk);
        }
    }

    /**
     * Rebuilds the given tenant's state and sends it to that tenant's listeners if it
     * changed. Safe to call from any mutation; concurrent calls for the same tenant are
     * coalesced (a different tenant's publish() proceeds independently).
     */
    async publish(tenantId) {
        const hasListener = [...this.listeners].some((l) => l.tenantId === tenantId);
        if(!hasListener) {
            return;
        }

        if(this.publishingTenants.has(tenantId)) {
            this.publishAgainTenants.add(tenantId);
            return;
        }

        this.publishingTenants.add(tenantId);
        try {
            let again = true;
            while(again) {
                this.publishAgainTenants.delete(tenantId);
                const state = await buildStateForTenant(tenantId);
                // server_now changes every call, so compare without it
                const { server_now, ...rest } = state;
                const json = JSON.stringify(rest);

                if(json !== this.lastJsonByTenant.get(tenantId)) {
                    this.lastJsonByTenant.set(tenantId, json);
                    this.eventIdByTenant.set(tenantId, (this.eventIdByTenant.get(tenantId) || 0) + 1);
                    this.broadcast(this.format(state, this.eventIdByTenant.get(tenantId)), tenantId);
                }

                again = this.publishAgainTenants.has(tenantId);
            }
        }
        catch(err) {
            global.logger?.error(err);
        }
        finally {
            this.publishingTenants.delete(tenantId);
        }
    }

    startTimers() {
        if(!this.tickTimer) {
            this.tickTimer = setInterval(() => {
                const tenantIds = new Set([...this.listeners].map((l) => l.tenantId));
                tenantIds.forEach((tenantId) => this.publish(tenantId));
            }, TICK_MS);
            this.tickTimer.unref();
        }

        if(!this.heartbeatTimer) {
            this.heartbeatTimer = setInterval(() => this.broadcastToAll(': ping\n\n'), HEARTBEAT_MS);
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
        this.lastJsonByTenant.clear();
        this.eventIdByTenant.clear();
    }
}

const ServiceStream = new ServiceStreamHub();

export default ServiceStream;
