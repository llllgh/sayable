import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    publicDir: 'public',
    build: {
      outDir: 'www',
      emptyOutDir: true,
      target: 'es2020',
      sourcemap: false,
    },
    server: {
      host: '0.0.0.0',
    },
  };
});
