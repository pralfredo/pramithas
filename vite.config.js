import { defineConfig } from 'vite'
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  base: '/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'esnext',
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          vendor: ['gsap'],
        },
      },
    },
  },
  plugins: [
    viteCompression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 10240,
    }),
  ],
});