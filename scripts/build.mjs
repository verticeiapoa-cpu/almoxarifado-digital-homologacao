import { spawn } from 'node:child_process';
import { rm, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await new Promise((resolveBuild, rejectBuild) => {
  const command = spawn(process.execPath, [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
  command.on('error', rejectBuild);
  command.on('exit', code => code === 0 ? resolveBuild() : rejectBuild(new Error(`Vite encerrou com código ${code}`)));
});
const server = resolve(root, 'dist', 'server');
await mkdir(server, { recursive: true });
await copyFile(resolve(root, 'dist', 'almoxarifado_digital', 'index.js'), resolve(server, 'index.js'));
