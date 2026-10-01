import { defineConfig } from 'vite';

const backendTarget = process.env.VITE_PROXY_TARGET?.trim() || 'http://127.0.0.1:3000';

const backendProxy = {
  target: backendTarget,
  changeOrigin: true,
};

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        ...backendProxy,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/health': backendProxy,
      '/ws': {
        ...backendProxy,
        ws: true,
      },
    },
  },
  preview: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        ...backendProxy,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/health': backendProxy,
      '/ws': {
        ...backendProxy,
        ws: true,
      },
    },
  },
});
