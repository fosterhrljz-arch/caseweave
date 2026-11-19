import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const binary = {
  name: 'caseweave-binary',
  load(id) {
    if (id.endsWith('?base64')) return `export default ${JSON.stringify(readFileSync(id.slice(0, -7)).toString('base64'))};`;
  },
};

export default defineConfig({
  base: './',
  plugins: [binary, viteSingleFile()],
  esbuild: { jsx: 'automatic' },
  build: { target: 'es2022', chunkSizeWarningLimit: 10000 },
  server: { port: 4178, strictPort: true },
  preview: { port: 4178, strictPort: true },
});
