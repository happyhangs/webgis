import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5182,
    strictPort: true,
  },
  envDir: '.',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-leaflet': ['leaflet', '@geoman-io/leaflet-geoman-free'],
          'vendor-icons': ['lucide-react'],
          'vendor-geo': ['@turf/area', '@turf/length', 'geotiff', 'jszip'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
