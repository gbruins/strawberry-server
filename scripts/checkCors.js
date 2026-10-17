// Usage: BASE_URL=http://localhost:10077/api/v1 ORIGIN=https://localhost:5199 node scripts/checkCors.js
// Run against a server started with CORS_ORIGINS including ORIGIN.
const BASE = process.env.BASE_URL || 'http://localhost:10077/api/v1';
const ORIGIN = process.env.ORIGIN || 'https://localhost:5199';
const BAD_ORIGIN = 'https://evil.example';
let failed = 0;
const check = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed = 1;
};

const preflight = (origin, headers) => fetch(`${BASE}/services/next/stream`, {
    method: 'OPTIONS',
    headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': headers
    }
});

const ok = await preflight(ORIGIN, 'authorization,last-event-id');
const allowed = (ok.headers.get('access-control-allow-headers') || '').toLowerCase();
check('preflight succeeds for allowed origin', ok.status === 200 || ok.status === 204);
check('allow-origin echoes the origin', ok.headers.get('access-control-allow-origin') === ORIGIN);
check('Authorization header allowed', allowed.includes('authorization'));
check('Last-Event-ID header allowed', allowed.includes('last-event-id'));

const bad = await preflight(BAD_ORIGIN, 'authorization');
check('unlisted origin gets no allow-origin', !bad.headers.get('access-control-allow-origin'));

process.exit(failed);
