export const basePlugin = {
    name: 'basePlugin',
    version: '1.0.0',
    register: async function (server, options) {
        // Used by the host's health check; deliberately touches nothing else so a
        // database blip does not get the server restarted
        server.route({
            method: 'GET',
            path: '/health',
            options: { auth: false, plugins: { 'hapi-rate-limit': { enabled: false } } },
            handler: () => ({ ok: true })
        });
    }
}
