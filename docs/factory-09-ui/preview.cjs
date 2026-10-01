// Local acceptance launcher: current Vite build, canonical proxy rules, no alternate application.
const path = require('node:path');

(async () => {
  const { preview } = await import('../../node_modules/vite/dist/node/index.js');
  const root = path.resolve(__dirname, '../..');
  const backendProxy = { target: 'http://127.0.0.1:3000', changeOrigin: true };
  await preview({
    root: path.join(root, 'frontend'),
    configFile: false,
    preview: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { ...backendProxy, rewrite: (url) => url.replace(/^\/api/, '') },
        '/health': backendProxy,
        '/ws': { ...backendProxy, ws: true },
      },
    },
  });
  console.log('FACTORY09 canonical-source preview at 127.0.0.1:5173');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
