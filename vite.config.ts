import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mangaServer } from './server/plugin.ts';

export default defineConfig({
  plugins: [react(), mangaServer(process.cwd())],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
});
