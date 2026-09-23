import { build } from 'esbuild'
await build({ entryPoints: ['src/lib/videoServerBridge.ts'], outfile: 'server-dist/videoShared.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
  logLevel: 'warning' })
process.stdout.write('Shared video parsers, physics and geometry bundled for server.\n')
