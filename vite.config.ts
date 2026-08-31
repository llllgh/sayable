import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    publicDir: 'public',
    define: {
      __SAYABLE_DEFAULT_BASE_URL__: JSON.stringify(env.ARK_BASE_URL || ''),
      __SAYABLE_DEFAULT_MODEL__: JSON.stringify(env.ARK_MODEL_ID || ''),
    },
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
