#!/usr/bin/env node
/**
 * Publish the VitePress site in `docs/` to the standalone documentation repo.
 *
 * Strategy: clone the target repository into a temporary directory, replace its
 * tracked content with the current `docs/` working tree, then commit and push.
 * The main repository is never modified and no history is rewritten, so this is
 * safe to run repeatedly. `.git` and `.github` inside the target are preserved,
 * which keeps an existing Pages workflow untouched.
 *
 * Usage (from the repository root):
 *   npm run docs:publish                 # sync and push
 *   npm run docs:publish -- --dry-run    # sync locally, print the diff, do not push
 *   npm run docs:publish -- --with-screenshots
 *                                        # include public/assets/screenshots
 *
 * Environment overrides:
 *   DOCS_REMOTE  target repository URL
 *   DOCS_BRANCH  target branch (default: main)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const docsDir = path.join(repoRoot, 'docs');
const workflowTemplate = path.join(repoRoot, 'scripts', 'docs-pages-workflow.yml');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const withScreenshots = args.includes('--with-screenshots');
const remote = process.env.DOCS_REMOTE || 'https://github.com/PayayaKamo/KomaYomi-docs.git';
const branch = process.env.DOCS_BRANCH || 'main';

/** Paths inside `docs/` that must not be published. */
const excluded = new Set(['node_modules', '.git', '.vitepress/dist', '.vitepress/cache', '.template-tmp', 'README.md']);
if (!withScreenshots) excluded.add('public/assets/screenshots');

const keepInTarget = new Set(['.git', '.github']);

function run(cmd, cmdArgs, options = {}) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: 'pipe', ...options });
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function isExcluded(relativePath) {
  if (excluded.has(relativePath)) return true;
  for (const prefix of excluded) {
    if (relativePath.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function copyTree(source, destination, relative = '') {
  const entries = fs.readdirSync(path.join(source, relative), { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    // `.github` is owned by the target repository, never by `docs/`.
    if (rel === '.github') continue;
    if (isExcluded(rel)) continue;
    const from = path.join(source, rel);
    const to = path.join(destination, rel);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copied += copyTree(source, destination, rel);
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    }
  }
  return copied;
}

function emptyExcept(directory) {
  for (const entry of fs.readdirSync(directory)) {
    if (keepInTarget.has(entry)) continue;
    fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
  }
}

function hasWorkflow(directory) {
  const workflows = path.join(directory, '.github', 'workflows');
  if (!fs.existsSync(workflows)) return false;
  return fs.readdirSync(workflows).some((name) => /\.ya?ml$/.test(name));
}

function step(message) {
  log(`\n==> ${message}`);
}

if (!fs.existsSync(path.join(docsDir, 'package.json'))) {
  throw new Error(`Cannot find a VitePress project at ${docsDir}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'komayomi-docs-'));
const checkout = path.join(tmpRoot, 'repo');

step(`Cloning ${remote} (${branch})`);
let cloned = true;
try {
  run('git', ['clone', '--depth', '1', '--branch', branch, remote, checkout]);
} catch (error) {
  cloned = false;
  log('Target branch not available; creating a fresh working copy instead.');
  fs.mkdirSync(checkout, { recursive: true });
  run('git', ['init', '--initial-branch', branch], { cwd: checkout });
  run('git', ['remote', 'add', 'origin', remote], { cwd: checkout });
  if (error.stderr) log(String(error.stderr).trim());
}

step('Replacing tracked content (preserving .git and .github)');
emptyExcept(checkout);
const copied = copyTree(docsDir, checkout);
log(`Copied ${copied} files from docs/`);

step('Checking the Pages workflow');
if (!hasWorkflow(checkout)) {
  const target = path.join(checkout, '.github', 'workflows', 'pages.yml');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(workflowTemplate, target);
  log('Installed .github/workflows/pages.yml from scripts/docs-pages-workflow.yml');
} else {
  log('Existing workflow found in the target repository; left untouched.');
}

if (!cloned) {
  // A fresh repository has no commit yet, so make sure the branch exists locally.
  run('git', ['checkout', '-B', branch], { cwd: checkout });
}

const identity = (() => {
  try {
    return {
      name: run('git', ['config', 'user.name'], { cwd: checkout }).trim(),
      email: run('git', ['config', 'user.email'], { cwd: checkout }).trim(),
    };
  } catch {
    return { name: '', email: '' };
  }
})();
if (!identity.name) run('git', ['config', 'user.name', 'PayayaKamo'], { cwd: checkout });
if (!identity.email) {
  run('git', ['config', 'user.email', 'payayakamo@users.noreply.github.com'], { cwd: checkout });
}

step('Staging changes');
run('git', ['add', '--all'], { cwd: checkout });
const diff = run('git', ['status', '--porcelain'], { cwd: checkout }).trim();
if (!diff) {
  log('Nothing to publish: the target repository is already up to date.');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(0);
}
log(diff.split('\n').slice(0, 40).join('\n'));
if (diff.split('\n').length > 40) log(`... ${diff.split('\n').length - 40} more`);

const timestamp = new Date().toISOString();
run('git', ['commit', '-m', `docs: sync from main repository ${timestamp}`], { cwd: checkout });
const commit = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: checkout }).trim();
log(`Created commit ${commit}`);

if (dryRun) {
  log(`\nDry run: skipped push. Working copy kept at ${checkout}`);
  process.exit(0);
}

step(`Pushing to origin/${branch}`);
try {
  run('git', ['push', 'origin', `HEAD:${branch}`], { cwd: checkout, stdio: 'inherit' });
  log(`\nPublished ${commit} to ${remote} (${branch})`);
  log('GitHub Pages usually rebuilds within 1-3 minutes after the workflow finishes.');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
