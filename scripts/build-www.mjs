// 筋トレLAB — iOS(Capacitor)用 www/ 生成スクリプト
// Web版は素の静的サイトのまま。iOSラッパーは webDir=www を内包するため、
// アプリに必要な静的ファイルだけを www/ へコピーする(dev/内部ファイルは除外)。
// 使い方: node scripts/build-www.mjs  (npm run build:www)
import { rm, mkdir, cp, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'www');

// アプリに含める静的アセットのホワイトリスト(これ以外=dev/内部ファイルは入れない)
const INCLUDE = [
  'index.html',
  'manifest.webmanifest',
  'firebase-messaging-sw.js',
  'css',
  'js',
  'assets',
];

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  let copied = 0;
  for (const name of INCLUDE) {
    const src = join(ROOT, name);
    if (!(await exists(src))) { console.warn(`[build-www] skip (not found): ${name}`); continue; }
    await cp(src, join(OUT, name), { recursive: true });
    copied++;
    console.log(`[build-www] + ${name}`);
  }
  console.log(`[build-www] done -> www/ (${copied} entries)`);
}
main().catch(e => { console.error('[build-www] failed', e); process.exit(1); });
