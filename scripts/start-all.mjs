#!/usr/bin/env node
/**
 * 一键启动：SQLite（按需建库）→ 后端 → 前端
 *
 * 用法：
 *   双击根目录 start-all.bat
 *   或 node scripts/start-all.mjs
 *
 * 可选环境变量：
 *   PORT           后端端口，默认取 backend/.env
 *   FRONTEND_PORT  前端端口，默认 5173
 *   DATABASE_URL   覆盖 backend/.env 中的数据库连接
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const runDir = path.join(root, '.run');
const logFile = (name) => path.join(runDir, `${name}.log`);
const pidFile = (name) => path.join(runDir, `${name}.json`);

const isWin = process.platform === 'win32';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readEnvFile(file) {
  const map = {};
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[m[1]] = value;
  }
  return map;
}

function resolveDbFile(url) {
  if (!url || !url.startsWith('file:')) return null;
  let p = url.slice('file:'.length).replace(/^\/\//, '');
  return path.resolve(backendDir, 'prisma', p.replace(/^\.\//, ''));
}

function portOwner(port) {
  if (!isWin) {
    const r = spawnSync('sh', ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null | head -1`], {
      encoding: 'utf8',
    });
    const pid = Number((r.stdout || '').trim());
    return pid || null;
  }
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    const m = line.trim().match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/);
    if (m && Number(m[1]) === port) return Number(m[2]);
  }
  return null;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function readRecord(name) {
  const file = pidFile(name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function removeRecord(name) {
  const file = pidFile(name);
  if (existsSync(file)) unlinkSync(file);
}

function killTree(pid) {
  if (!isWin) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
    return;
  }
  const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
  spawnSync(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
}

function tail(file, lines = 20) {
  try {
    const text = readFileSync(file, 'utf8').trim();
    if (!text) return '';
    return text.split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

function npmRun(args, cwd) {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(npmCli)) throw new Error(`找不到 npm-cli.js：${npmCli}`);
  console.log(`> npm ${args.join(' ')}  (${path.relative(root, cwd)})`);
  const r = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} 失败（退出码 ${r.status}）`);
}

async function waitHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return true;
    } catch {
      /* not ready yet */
    }
    await sleep(500);
  }
  return false;
}

function spawnService(name, args, cwd, port, entry) {
  mkdirSync(runDir, { recursive: true });
  const outFd = openSync(logFile(name), 'w');
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', outFd, outFd],
  });
  closeSync(outFd);
  if (!child.pid) throw new Error(`${name} 进程启动失败`);
  child.unref();
  writeFileSync(
    pidFile(name),
    JSON.stringify({ pid: child.pid, port, entry, cwd, startedAt: new Date().toISOString() }, null, 2),
  );
  return child.pid;
}

async function main() {
  mkdirSync(runDir, { recursive: true });

  const envFile = readEnvFile(path.join(backendDir, '.env'));
  const backendPort = Number(process.env.PORT || envFile.PORT || 3000);
  const frontendPort = Number(process.env.FRONTEND_PORT || 5173);
  const dbUrl = process.env.DATABASE_URL || envFile.DATABASE_URL || 'file:./dev.db';
  const dbFile = resolveDbFile(dbUrl);

  console.log('=== 检查端口 ===');
  let backendRunning = false;
  let frontendRunning = false;

  const backendRec = readRecord('backend');
  const backendOwner = portOwner(backendPort);
  if (backendRec && alive(backendRec.pid)) {
    if (backendOwner === backendRec.pid) {
      backendRunning = true;
      console.log(`后端已在运行（PID ${backendRec.pid}，端口 ${backendPort}），跳过启动`);
    } else {
      throw new Error(
        `检测到上次启动的后端进程（PID ${backendRec.pid}）仍在，但端口 ${backendPort} 未监听。请先执行停止脚本。`,
      );
    }
  } else if (backendOwner) {
    throw new Error(
      `端口 ${backendPort} 已被其他进程（PID ${backendOwner}）占用。请先关闭该进程，或修改 backend/.env 的 PORT。`,
    );
  } else {
    if (backendRec) removeRecord('backend');
  }

  const frontendRec = readRecord('frontend');
  const frontendOwner = portOwner(frontendPort);
  if (frontendRec && alive(frontendRec.pid)) {
    if (frontendOwner === frontendRec.pid) {
      frontendRunning = true;
      console.log(`前端已在运行（PID ${frontendRec.pid}，端口 ${frontendPort}），跳过启动`);
    } else {
      throw new Error(
        `检测到上次启动的前端进程（PID ${frontendRec.pid}）仍在，但端口 ${frontendPort} 未监听。请先执行停止脚本。`,
      );
    }
  } else if (frontendOwner) {
    throw new Error(
      `端口 ${frontendPort} 已被其他进程（PID ${frontendOwner}）占用。请先关闭该进程，或设置 FRONTEND_PORT 后重试。`,
    );
  } else {
    if (frontendRec) removeRecord('frontend');
  }

  if (backendRunning && frontendRunning) {
    console.log(`\n前后端均已在运行：http://localhost:${frontendPort}`);
    return;
  }

  let startedBackend = false;
  try {
    if (!backendRunning) {
      if (!existsSync(path.join(backendDir, 'node_modules', '.bin', 'nest'))) {
        console.log('未找到后端依赖，正在安装…');
        npmRun(['install'], backendDir);
      }

      console.log('\n=== 准备数据库 ===');
      if (dbFile && (!existsSync(dbFile) || statSync(dbFile).size === 0)) {
        console.log('未找到 SQLite 数据库，开始建表并写入种子数据…');
        npmRun(['run', 'setup'], backendDir);
      } else if (dbFile) {
        console.log(`SQLite 数据库已就绪：${path.relative(root, dbFile)}（保留现有数据）`);
      } else {
        console.log('检测到外部数据库配置，跳过 SQLite 初始化');
      }

      console.log('\n=== 编译并启动后端 ===');
      npmRun(['run', 'build'], backendDir);
      const pid = spawnService('backend', ['dist/main.js'], backendDir, backendPort, 'dist/main.js');
      startedBackend = true;
      console.log(`后端进程已启动（PID ${pid}），等待健康检查…`);
      const ok = await waitHttp(`http://127.0.0.1:${backendPort}/api/meta/health`, 45000);
      if (!ok) {
        const log = tail(logFile('backend'));
        throw new Error(`后端健康检查超时（端口 ${backendPort}）。\n--- backend.log ---\n${log}`);
      }
      console.log('后端健康检查通过');
    }

    if (!frontendRunning) {
      console.log('\n=== 启动前端 ===');
      const viteBin = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
      if (!existsSync(viteBin)) {
        console.log('未找到前端依赖，正在安装…');
        npmRun(['install'], frontendDir);
        if (!existsSync(viteBin)) throw new Error('前端依赖安装后仍找不到 vite');
      }
      const pid = spawnService(
        'frontend',
        [viteBin, '--port', String(frontendPort), '--strictPort'],
        frontendDir,
        frontendPort,
        'vite/bin/vite.js',
      );
      console.log(`前端进程已启动（PID ${pid}），等待页面可访问…`);
      const ok = await waitHttp(`http://127.0.0.1:${frontendPort}/`, 45000);
      if (!ok) {
        const log = tail(logFile('frontend'));
        throw new Error(`前端启动超时（端口 ${frontendPort}）。\n--- frontend.log ---\n${log}`);
      }
      console.log('前端已可访问');
    }
  } catch (err) {
    console.error(`\n启动失败：${err.message}`);
    if (startedBackend) {
      const rec = readRecord('backend');
      if (rec && alive(rec.pid)) killTree(rec.pid);
      removeRecord('backend');
      console.error('已回滚本次启动的后端进程');
    }
    process.exitCode = 1;
    return;
  }

  console.log('\n=== 启动完成 ===');
  console.log(`前端：http://localhost:${frontendPort}`);
  console.log(`后端：http://localhost:${backendPort}/api`);
  console.log(`数据库：${dbFile ? `SQLite（${path.relative(root, dbFile)}）` : '外部数据库（按 .env 配置）'}`);
  console.log(`日志：${path.relative(root, logFile('backend'))} / ${path.relative(root, logFile('frontend'))}`);
  console.log('停止：运行 stop-all.bat（或 node scripts/stop-all.mjs）');
  console.log('\n测试账号：admin/admin123；student01~10/student123；mentor01~06/mentor123');
}

main().catch((err) => {
  console.error(`\n启动失败：${err.message}`);
  process.exitCode = 1;
});
