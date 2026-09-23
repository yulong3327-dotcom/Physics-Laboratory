import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { unzipSync, zipSync } from 'fflate';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = path.join(projectRoot, 'release');
const outputName = 'circuit-converter-vibehub.zip';
const rootFiles = new Set([
  '.env.example',
  '.gitignore',
  'package.json',
  'package-lock.json',
  'index.html',
  'README.md',
  'vite.config.ts',
  'postcss.config.js',
  'tailwind.config.js',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.server.json',
  'scripts/package-vibehub.mjs',
  'scripts/build-video-shared.mjs',
  'scripts/generate-prompts.mjs',
]);
const includedDirectories = ['dist', 'server-dist', 'src', 'server', 'public', 'docs', 'video-renderer', 'prompts'];
const allowedExtensions = new Set([
  '.py', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.txt',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.wasm',
]);
const forbiddenDirectories = new Set([
  'node_modules', '.git', 'release', 'artifacts', 'test-results', 'playwright-report',
  'tests', 'e2e', 'originals',
]);

function isAllowed(archivePath) {
  if (rootFiles.has(archivePath)) return true;
  const segments = archivePath.split('/');
  const filename = segments.at(-1);
  if (segments.some((segment) => segment.startsWith('.') || forbiddenDirectories.has(segment))) return false;
  if (filename.endsWith('.map') || filename.endsWith('.tsbuildinfo')) return false;
  return includedDirectories.includes(segments[0]) && allowedExtensions.has(path.extname(filename).toLowerCase());
}

async function readLocalSecrets() {
  const secrets = [];
  for (const entry of await readdir(projectRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\.env(?:\.|$)/.test(entry.name) || entry.name === '.env.example') continue;
    const values = parseEnv(await readFile(path.join(projectRoot, entry.name), 'utf8'));
    for (const [name, value] of Object.entries(values)) {
      if (/(?:KEY|TOKEN|SECRET|PASSWORD|DB_URL|DATABASE_URL|CONNECTION)/i.test(name) && value.length >= 8) {
        secrets.push({ name, bytes: Buffer.from(value) });
      }
    }
  }
  return secrets;
}

const entries = {};
const secrets = await readLocalSecrets();

async function addFile(archivePath) {
  if (!isAllowed(archivePath)) return;
  const bytes = await readFile(path.join(projectRoot, archivePath));
  for (const secret of secrets) {
    if (bytes.includes(secret.bytes)) {
      throw new Error(`Refusing to package ${archivePath}: contains the local value of ${secret.name}.`);
    }
  }
  entries[archivePath] = [new Uint8Array(bytes), { mtime: new Date('2020-01-01T00:00:00Z') }];
}

async function addDirectory(directory) {
  for (const entry of (await readdir(path.join(projectRoot, directory), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const archivePath = `${directory}/${entry.name}`;
    if (entry.name.startsWith('.') || forbiddenDirectories.has(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Refusing to package symbolic link: ${archivePath}`);
    if (entry.isDirectory()) await addDirectory(archivePath);
    else if (entry.isFile()) await addFile(archivePath);
  }
}

for (const filename of [...rootFiles].sort()) await addFile(filename);
for (const directory of includedDirectories) await addDirectory(directory);

for (const requiredFile of ['package.json', 'package-lock.json', 'dist/index.html', 'server-dist/index.js']) {
  if (!entries[requiredFile]) throw new Error(`Missing required file: ${requiredFile}. Run npm run build first.`);
}

const manifest = JSON.parse(Buffer.from(entries['package.json'][0]).toString('utf8'));
if (manifest.scripts?.start !== 'node server-dist/index.js') throw new Error('Unexpected production start command.');

const zipped = zipSync(entries, { level: 6 });
if (zipped.byteLength > 500 * 1024 * 1024) throw new Error('The deployment ZIP exceeds the platform 500 MB limit.');
const unpacked = unzipSync(zipped);
for (const [archivePath, bytes] of Object.entries(unpacked)) {
  if (!isAllowed(archivePath) || path.posix.isAbsolute(archivePath) || archivePath.split('/').includes('..')) {
    throw new Error(`Unexpected file in deployment ZIP: ${archivePath}`);
  }
  if (!Buffer.from(bytes).equals(Buffer.from(entries[archivePath][0]))) {
    throw new Error(`ZIP verification failed for ${archivePath}.`);
  }
}
if (Object.keys(unpacked).length !== Object.keys(entries).length) throw new Error('ZIP entry count mismatch.');

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, outputName), zipped);
const sha256 = createHash('sha256').update(zipped).digest('hex');
await writeFile(path.join(outputDirectory, `${outputName}.sha256`), `${sha256}  ${outputName}\n`);
process.stdout.write(`Created release/${outputName}\n`);
process.stdout.write(`${Object.keys(entries).length} files; ${(zipped.byteLength / 1024 / 1024).toFixed(2)} MB\n`);
process.stdout.write(`Verified root layout, allowed files, local-secret scan (${secrets.length} values), and ZIP contents.\n`);
process.stdout.write(`SHA256: ${sha256}\n`);
