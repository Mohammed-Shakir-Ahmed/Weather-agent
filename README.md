# Weather-agent

A simple weather information app built with Node.js.

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:3000.

## Free deployment options

This app is compatible with free Node.js hosting platforms such as:
- Render
- Railway
- Fly.io
- Cloudflare Workers

### Recommended: Render
1. Push this repository to GitHub.
2. Create a new Web Service on Render.
3. Connect the GitHub repository.
4. Set the build command to `npm install`.
5. Set the start command to `node server.js`.
6. Deploy.

The app already listens on the `PORT` environment variable, which Render provides automatically.
