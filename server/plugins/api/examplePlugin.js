export const examplePlugin = {
    name: 'examplePlugin',
    version: '1.0.0',
    register: async function (server, options) {
        server.route({
            method: 'GET',
            path: '/plugin',
            handler: (request, h) => {
                return 'Hello from plugin!';
            }
        });
    }
};
