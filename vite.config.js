import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Shopping List',
        short_name: 'Shopping',
        description: 'Shared shopping list with predictions, receipts and spending insights.',
        theme_color: '#fdf1c9',
        background_color: '#fdf1c9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/\.netlify\//, /^\/\.well-known\//, /^\/privacy/, /^\/delete-account/], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: (id) => (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase') ? 'firebase' : id.includes('chart.js') ? 'charts' : undefined) } },
  },
  test: { include: ['src/**/*.test.js', 'netlify/**/*.test.js'] },
});
