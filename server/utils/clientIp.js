// Behind a reverse proxy every connection comes from the proxy, so the caller's address has to
// come from X-Forwarded-For. Each trusted proxy appends the address of its peer, so the entry
// to trust is counted from the right. Counting from the left would let a caller choose their own.
// TRUSTED_PROXY_HOPS is the number of proxies in front of this server; 0 ignores the header.
export function pickClientIp(forwardedFor, remoteAddress, hops = trustedProxyHops()) {
    if(!hops || !forwardedFor) {
        return remoteAddress;
    }

    const parts = String(forwardedFor).split(',').map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - hops] || parts[0] || remoteAddress;
}

export function trustedProxyHops() {
    const n = parseInt(process.env.TRUSTED_PROXY_HOPS, 10);
    return Number.isInteger(n) && n > 0 ? n : 0;
}

export function getClientIp(request) {
    return pickClientIp(request.headers['x-forwarded-for'], request.info.remoteAddress);
}
