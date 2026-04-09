import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,   // dostępny z iPada przez WiFi (0.0.0.0)
    port: 3001,
  },
  preview: {
    host: true,
    port: 3001,
  },
});
