import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerBuild = resolve(root, 'dist', 'almoxarifado_digital');
const server = resolve(root, 'dist', 'server');
await rm(server, { recursive: true, force: true });
await mkdir(server, { recursive: true });
await copyFile(resolve(workerBuild, 'index.js'), resolve(server, 'index.js'));
