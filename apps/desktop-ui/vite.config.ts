import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4897',
        changeOrigin: false
      },
      '/assets/providers': {
        target: 'http://127.0.0.1:4897',
        changeOrigin: false
      }
    }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_']
});
