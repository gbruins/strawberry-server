import AuthController from './AuthController.js';

const Ctrl = new AuthController();

// Login/signup/password-reset are no longer server routes — strawberry-admin calls Supabase
// Auth directly for those (contracts/admin-auth.md "Removed"; research.md #2).
export const authPlugin = {
    name: 'authPlugin',
    version: '1.0.0',
    register: async function (server, options) {
        server.route([
            {
                method: 'GET',
                path: '/admin/me',
                options: {
                    description: 'Returns the caller\'s own tenant/role, resolved from their bearer token',
                    handler: (request, h) => {
                        return Ctrl.meHandler(request, h);
                    }
                }
            }
        ]);
    }
}
