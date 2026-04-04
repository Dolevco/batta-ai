import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import mkcert from 'vite-plugin-mkcert';

const defaultKey = path.resolve(process.cwd(), 'packages/api/ssl/key.pem');
const defaultCert = path.resolve(process.cwd(), 'packages/api/ssl/cert.pem');

const useHttps = process.env.HTTPS !== 'false';

let httpsOption: false | { key: string; cert: string } = false;
if (useHttps) {
  const keyPath = process.env.SSL_KEY_PATH || defaultKey;
  const certPath = process.env.SSL_CERT_PATH || defaultCert;
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    httpsOption = { key: fs.readFileSync(keyPath, 'utf-8'), cert: fs.readFileSync(certPath, 'utf-8') };
  } else {
    // Let vite-plugin-mkcert generate a trusted cert when present; otherwise fall back to HTTPS=false
    httpsOption = false;
  }
}

export default defineConfig({
  plugins: [react(), useHttps ? mkcert() : null].filter(Boolean),
  server: {
    port: 3000,
    https: httpsOption ? httpsOption : undefined,
    proxy: {
      '/api': {
        target: useHttps ? 'https://localhost:3001' : 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
