#!/usr/bin/env node
/**
 * 交付前验证流程（verify → build web → serve for browser checks）。
 *
 *   pnpm verify:web
 *
 * 三道门依次跑，任何一道挂掉立刻停（后续的步骤在前一步不绿时没有意义）：
 *
 *   1. pnpm lint          ESLint
 *   2. pnpm typecheck     tsc --noEmit（全部 workspace）
 *   3. pnpm test          Jest（全部 workspace）
 *   4. pnpm build:web     expo export --platform web + PWA 后处理
 *   5. 起一个静态服务器   SPA fallback → apps/mobile/dist
 *
 * 第 5 步是给「浏览器实测」用的：在这个进程还活着的时候，用浏览器打开
 * 打印出来的地址，点一遍改动涉及的行为并截图确认，然后 Ctrl-C 结束。
 * 服务端只读静态产物，不会写任何东西。
 *
 * 参数（都是可选的，用来缩短内层循环，不是用来跳过门禁的）：
 *   --skip-tests   跳过第 3 步（改 UI 时最快的一轮）
 *   --skip-build   跳过第 4 步，复用已有的 dist
 *   --no-serve     只跑门禁就退出，不起服务器
 *   --port=4180    换端口（默认 4180；PORT=… 环境变量同样有效）
 *
 * 门禁全绿 ≠ 可以交付 —— 还必须走完浏览器截图确认，见
 * `.trellis/spec/project/quality-guidelines.md` 的「Web 验证门禁」。
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'apps/mobile/dist');

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => !arg.startsWith('--port')));
const portArg = args.find((arg) => arg.startsWith('--port='));
const PORT = Number(portArg?.slice('--port='.length) ?? process.env.PORT ?? 4180);

/** 跑一条命令，继承 stdio；非 0 退出即 reject。 */
function run(label, command, commandArgs) {
  return new Promise((resolve, reject) => {
    console.log(`\n▸ ${label}`);
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} 失败（退出码 ${code}）— 后续步骤不再执行。`));
    });
  });
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/**
 * 静态服务器。expo 的 web 输出是 `output: "single"`（SPA），产物里只有
 * 一个 index.html，所以任何未命中的路径都必须回落到它 —— 否则直接访问
 * /settings 会 404，而应用内的路由跳转却「看起来正常」。
 */
function serve() {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(`找不到 ${path.relative(ROOT, DIST)}/index.html — 先跑一次 pnpm build:web。`);
  }
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    // path.join 会先归一化 `..`，所以越界路径在 startsWith 这里被挡住。
    let filePath = path.join(DIST, pathname);
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!existsSync(filePath)) filePath = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });
  // 端口被上一次没关掉的服务器占着，是本脚本自己最常见的失败方式。
  // 不接住的话会甩一整段 net 模块的堆栈，看不出是端口冲突。
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `\n❌ 端口 ${PORT} 已被占用 —— 很可能上一次 pnpm verify:web 的服务器还在跑。\n` +
          `   关掉它（lsof -ti :${PORT} | xargs kill），或换端口：--port=4181。\n`
      );
    } else {
      console.error(`\n❌ 静态服务器启动失败：${error.message}\n`);
    }
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log(`\n✅ 门禁全绿。Web 产物已就绪：\n   http://localhost:${PORT}\n`);
    console.log('   现在用浏览器打开上面的地址，点一遍本次改动涉及的行为并截图确认。');
    console.log('   确认完毕后回到这里 Ctrl-C 结束。\n');
  });
  // 服务器本来就打算跑到你 Ctrl-C 为止，所以 Ctrl-C 属于正常收尾，不是失败。
  // 不接管的话 pnpm 会把 SIGTERM(143) 报成 [ELIFECYCLE] Command failed，
  // 让「验证通过」看起来像「验证失败」。
  const shutdown = (signal) => {
    server.close(() => {
      console.log(`\n收到 ${signal}，静态服务器已关闭。门禁结果见上面的输出。`);
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

console.log('交付前验证流程：lint → typecheck → test → build:web → serve');
await run('1/4 lint', 'pnpm', ['lint']);
await run('2/4 typecheck', 'pnpm', ['typecheck']);
if (!flags.has('--skip-tests')) await run('3/4 test', 'pnpm', ['test']);
if (!flags.has('--skip-build')) await run('4/4 build:web', 'pnpm', ['build:web']);
if (!flags.has('--no-serve')) serve();