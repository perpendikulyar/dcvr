// Bundles the Electron main process (with the whole server) and the preload script.
// One self-contained file means the packaged app needs no node_modules.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: 'linked', logLevel: 'info' };

await build({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  format: 'esm',
  external: ['electron'],
  // CommonJS dependencies (fastify & co.) call require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

await build({
  ...common,
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/preload.cjs',
  format: 'cjs',
  external: ['electron'],
});
