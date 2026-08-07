import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendDir = path.join(root, 'backend');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const pythonCmd = process.env.WEBGIS_PYTHON
  || (process.platform === 'win32' ? 'python' : 'python3');

// Load minimal .env (AMAP_KEY etc.) without adding a dotenv dependency.
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
}

const children = [];

function checkUrl(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function startProcess(label, command, args, cwd) {
  console.log(`[${label}] starting: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
  });
  children.push(child);
  child.on('exit', (code) => {
    console.log(`[${label}] exited with code ${code ?? 'null'}`);
  });
  return child;
}

async function main() {
  const backendOk = await checkUrl('http://127.0.0.1:8765/health');
  if (backendOk) {
    console.log('[backend] already running at http://127.0.0.1:8765/');
  } else {
    startProcess('backend', pythonCmd, ['-m', 'farmland_segmenter', '--serve'], backendDir);
  }

  const frontendOk = await checkUrl('http://127.0.0.1:5182/');
  if (frontendOk) {
    console.log('[frontend] already running at http://127.0.0.1:5182/');
  } else {
    startProcess('frontend', process.execPath, [viteCli], root);
  }

  console.log('');
  console.log('WebGIS:     http://127.0.0.1:5182/');
  console.log('训练中心:   http://127.0.0.1:5182/train');
  console.log('后端接口:   http://127.0.0.1:8765/');
  console.log('Press Ctrl+C to stop processes started by this command.');

  if (children.length === 0) return;
}

process.on('SIGINT', () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  process.exit(0);
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
