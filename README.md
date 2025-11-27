# strawberry-server

## Local development

Use a tool like `mkcert` to generate a trusted local SSL cert. It's free, one-time setup, and makes your dev environment match production.

Steps on macOS (since you're using /etc/hosts):

Install mkcert:
```
brew install mkcert
brew install nss  # For Firefox support, optional
```

Create your local CA (run once):
```
mkcert -install
```

Generate certs for your domain:
```
mkcert strawberry.local localhost 127.0.0.1
```

This creates strawberry.local+2.pem and strawberry.local+2-key.pem.

### For the UI
Update `vite.config.js`
```
export default {
  server: {
    host: 'strawberry.local',
    https: {
      key: fs.readFileSync(path.resolve('./strawberry.local+2-key.pem')),
      cert: fs.readFileSync(path.resolve('./strawberry.local+2.pem')),
    },
    port: 5173,
  },
};
```

### For your Hapi.js API server (assuming it's on a different port, e.g., 3000):
Use Hapi's hapi-ssl or built-in TLS:
```
const fs = require('fs');
const Hapi = require('@hapi/hapi');

const server = Hapi.server({
  host: 'strawberry.local',
  port: 3000,
  tls: {
    key: fs.readFileSync('./strawberry.local+2-key.pem'),
    cert: fs.readFileSync('./strawberry.local+2.pem'),
  },
});
```

### API server TLS behavior (server/index.js)

The API server now only loads the local TLS certificate when running in development. `server/index.js` will attach the `tls` option only when `process.env.NODE_ENV === 'development'`.

- To run the server with local TLS (development), place your generated cert files (`strawberry.local+2.pem` and `strawberry.local+2-key.pem`) in the project root (one level above the `server/` directory) so the server can read them via `path.resolve('../strawberry.local+2.pem')`.
- Start in development mode (TLS enabled), make sure the .env file is updated with:
```bash
NODE_ENV=development
```
- Start in production mode (TLS disabled — use your platform or reverse proxy for TLS), add this to .env
```bash
NODE_ENV=production
```

This keeps local development convenient (with mkcert-generated certs) while ensuring production deployments rely on proper platform-managed TLS.
