import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { sites } from './build/sites-vite-plugin';

export default defineConfig(async ({ command }) => {
  const cloudflarePlugins = [];
  if (command === 'build') {
    const { cloudflare } = await import('@cloudflare/vite-plugin');
    cloudflarePlugins.push(cloudflare({
      inspectorPort: false,
      config: {
        main: './worker/index.ts',
        compatibility_flags: ['nodejs_compat'],
      },
    }));
  }
  return {
    plugins: [react(), tailwindcss(), sites(), ...cloudflarePlugins],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // File watching can be disabled in AI Studio to prevent flickering during edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      allowedHosts: ['terminal.local'],
    },
  };
});
