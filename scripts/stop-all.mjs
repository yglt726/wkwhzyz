#!/usr/bin/env node
/**
 * 一键停止：只停止 start-all 启动并记录在 .run/*.json 里的进程。
 * 不会按端口或进程名盲杀，避免误伤其他 node / 开发服务。
 *
 * 用法：
 *   双击根目录 stop-all.bat
 *   或 node scripts/stop-all.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, '.run');
const isWin = process.platform === 'win32';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TARGETS = [
  { name: 'backend', label: '后端', pattern: /dist[\\/]main\.js/ },
  { name: 'frontend', label: '前端', pattern: /vite[\\/]bin[\\/]vite\.js/ },
];

function readRecord(name) {
  const file = path.join(runDir, `${name}.json`);
  if (!existsSync(file)) return null;
  try {
    return { file, data: JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return { file, data: null };
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

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
    if (m && Number(m[1]) === Number(port)) return Number(m[2]);
  }
  return null;
}

function commandLineOf(pid) {
  if (!isWin) {
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' });
    return (r.stdout || '').trim();
  }
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.CommandLine }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return (r.stdout || '').trim();
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

async function stopOne(target) {
  const rec = readRecord(target.name);
  if (!rec) {
    console.log(`${target.label}：未发现启动记录，跳过`);
    return true;
  }
  if (!rec.data || !Number(rec.data.pid)) {
    console.error(`${target.label}：.run/${target.name}.json 内容无法解析，未做任何操作，请手动检查`);
    return false;
  }

  const { pid, port } = rec.data;
  if (!alive(pid)) {
    unlinkSync(rec.file);
    console.log(`${target.label}：进程 ${pid} 已退出，已清理启动记录`);
    return true;
  }

  const cmdline = commandLineOf(pid);
  const owner = portOwner(port);
  const looksLikeOurs = target.pattern.test(cmdline);
  const ownsPort = owner === pid;

  if (!looksLikeOurs && !ownsPort) {
    console.error(
      `${target.label}：PID ${pid} 与启动时记录不匹配（可能已被系统复用），为安全起见不终止。\n` +
        `  命令行：${cmdline || '读取失败'}\n` +
        `  端口 ${port} 当前占用：${owner ?? '无'}\n` +
        `  如确认这是残留记录，可手动删除 ${path.relative(root, rec.file)}`,
    );
    return false;
  }

  console.log(`${target.label}：正在停止 PID ${pid}（端口 ${port}）…`);
  killTree(pid);

  for (let i = 0; i < 20; i++) {
    if (!alive(pid)) break;
    await sleep(250);
  }
  if (alive(pid)) {
    console.error(`${target.label}：PID ${pid} 仍未退出，请手动处理`);
    return false;
  }

  unlinkSync(rec.file);
  const remaining = portOwner(port);
  if (remaining) {
    console.error(`${target.label}：进程已退出，但端口 ${port} 仍被 PID ${remaining} 占用`);
    return false;
  }
  console.log(`${target.label}：已停止，端口 ${port} 已释放`);
  return true;
}

async function main() {
  console.log('=== 停止服务 ===');
  let ok = true;
  for (const target of TARGETS) {
    if (!(await stopOne(target))) ok = false;
  }
  console.log('\n数据库：SQLite 为嵌入式文件数据库，无独立进程，无需停止。');
  if (!ok) {
    console.error('部分服务未能正常停止，请查看上面的提示。');
    process.exitCode = 1;
    return;
  }
  console.log('停止完成。');
}

main().catch((err) => {
  console.error(`停止失败：${err.message}`);
  process.exitCode = 1;
});
