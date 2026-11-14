/**
 * Report user-visible Chinese left in frontend source.
 *
 * Why a script instead of a lint rule: the team writes Chinese comments and sample
 * data, so a plain regex would drown in false positives. This scanner strips comments
 * first and skips the locale resources, leaving only strings that should have gone
 * through `t()`.
 *
 *   node scripts/scan-hardcoded-zh.mjs           # report only
 *   node scripts/scan-hardcoded-zh.mjs --strict  # exit 1 when anything is found
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'src');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const SKIP_DIRS = new Set(['i18n']);
const SKIP_FILES = new Set(['global.d.ts']);
const strict = process.argv.includes('--strict');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (/\.(ts|tsx)$/.test(entry.name) && !SKIP_FILES.has(entry.name)) out.push(abs);
  }
  return out;
}

/** Remove comments while leaving string contents (including URLs) intact. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

const findings = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(process.cwd(), file);
  const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    if (!CJK.test(line)) return;
    const text = line.trim();
    if (!text) return;
    findings.push({ file: rel, line: index + 1, text: text.length > 160 ? `${text.slice(0, 157)}…` : text });
  });
}

if (!findings.length) {
  console.log('No hardcoded Chinese found in src/ (comments excluded).');
  process.exit(0);
}

const byFile = new Map();
for (const item of findings) {
  const list = byFile.get(item.file) ?? [];
  list.push(item);
  byFile.set(item.file, list);
}

console.log(`Hardcoded Chinese: ${findings.length} line(s) in ${byFile.size} file(s)\n`);
for (const [file, items] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${file} (${items.length})`);
  for (const item of items.slice(0, 12)) console.log(`  ${item.line}: ${item.text}`);
  if (items.length > 12) console.log(`  … ${items.length - 12} more`);
  console.log('');
}

if (strict) process.exit(1);
