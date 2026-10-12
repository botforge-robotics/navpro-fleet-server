import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Owned first-party copies of Open-RMF web (packages/), not vendor/.
      'rmf-dashboard-framework/components': path.resolve(
        __dirname,
        'packages/rmf-dashboard-framework/src/components/index.ts',
      ),
      'rmf-dashboard-framework/micro-apps': path.resolve(
        __dirname,
        'packages/rmf-dashboard-framework/src/micro-apps/index.ts',
      ),
      'rmf-dashboard-framework/services': path.resolve(
        __dirname,
        'packages/rmf-dashboard-framework/src/services/index.ts',
      ),
      'rmf-dashboard-framework/hooks': path.resolve(
        __dirname,
        'packages/rmf-dashboard-framework/src/hooks/index.ts',
      ),
      'api-client': path.resolve(__dirname, 'packages/api-client/lib/index.ts'),
      'rmf-models': path.resolve(__dirname, 'packages/rmf-models/lib'),
    },
    dedupe: [
      'react',
      'react-dom',
      'react-router',
      'react-router-dom',
      '@emotion/react',
      '@emotion/styled',
      '@mui/material',
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
      '/rmf': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
