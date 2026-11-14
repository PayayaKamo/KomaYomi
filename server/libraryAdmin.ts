import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, guessLang, listDirs, readLibraryConfig, writeLibraryConfig } from './library.ts';
import type { Lang } from '../shared/types.ts';

const BAD_NAME = /[\\/:*?"<>|]/;

function assertName(name: string): string {
  const clean = name.trim();
  if (!clean) throw new Error('目录名不能为空');
  if (BAD_NAME.test(clean) || clean === '.' || clean === '..') {
    throw new Error(`目录名「${clean}」包含非法字符（不能有 \\ / : * ? " < > |）`);
  }
  return clean;
}

/** 判断一个目录是否像「一卷」（里面有语言目录，或语言目录里还有话目录） */
function looksLikeVolume(dir: string): boolean {
  const subs = listDirs(dir);
  if (subs.some((d) => guessLang(d))) return true;
  return subs.some((sub) => listDirs(path.join(dir, sub)).some((d) => guessLang(d)));
}

export type AddVolumeResult = { added: string[]; warnings: string[] };

/**
 * 添加漫画：
 * - 只给 name：在 raw 下建空目录，提示用户放图
 * - 给 sourcePath：在 raw 下建 junction 指向外部目录（不复制文件，不占用额外空间）
 *   · 选中的就是一卷 → 挂一卷
 *   · 选中的是包含多卷的父目录 → 逐卷挂载
 */
export function addVolume(rawRoot: string, sourcePath?: string, rawName?: string): AddVolumeResult {
  fs.mkdirSync(rawRoot, { recursive: true });
  const warnings: string[] = [];
  const added: string[] = [];

  if (!sourcePath) {
    const name = assertName(rawName ?? '');
    const target = path.join(rawRoot, name);
    if (fs.existsSync(target)) return { added: [name], warnings: ['同名目录已存在，已自动识别'] };
    fs.mkdirSync(target, { recursive: true });
    warnings.push('已创建空目录，请把图片按 raw/卷名/语言/话号/01.jpg 放进去');
    return { added: [name], warnings };
  }

  const source = path.resolve(sourcePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`目录不存在：${source}`);
  }

  // 选中父目录时，把里面的每一卷分别挂进 raw
  let candidates: { name: string; dir: string }[] = [];
  if (looksLikeVolume(source) || !listDirs(source).length) {
    const name = assertName(rawName ?? path.basename(source));
    candidates = [{ name, dir: source }];
  } else {
    candidates = listDirs(source)
      .map((d) => path.join(source, d))
      .filter((d) => looksLikeVolume(d))
      .map((d) => ({ name: path.basename(d), dir: d }));
    if (!candidates.length) {
      const name = assertName(rawName ?? path.basename(source));
      candidates = [{ name, dir: source }];
      warnings.push('没有识别到语言目录，已按单卷添加，可在「卷设置」里指定语言目录');
    }
  }

  for (const candidate of candidates) {
    const target = path.join(rawRoot, candidate.name);
    if (fs.existsSync(target)) {
      let same = false;
      try {
        same = fs.realpathSync(target) === fs.realpathSync(candidate.dir);
      } catch {
        same = false;
      }
      if (same) {
        added.push(candidate.name);
        warnings.push(`「${candidate.name}」已在图库中，已自动识别`);
        continue;
      }
      throw new Error(`raw 下已存在同名目录「${candidate.name}」，请换个名字或先移除`);
    }
    try {
      fs.symlinkSync(candidate.dir, target, 'junction');
      added.push(candidate.name);
    } catch (err) {
      throw new Error(`创建目录链接失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { added, warnings };
}

/** 从图库移除：只删 junction，绝不删除真实目录里的图片 */
export function removeVolume(rawRoot: string, dataRoot: string, volume: string): { removed: boolean; warnings: string[] } {
  const target = path.join(rawRoot, volume);
  const warnings: string[] = [];
  if (!fs.existsSync(target)) {
    warnings.push('目录不存在，已从图库配置中移除');
  } else {
    const stat = fs.lstatSync(target);
    if (!stat.isSymbolicLink()) {
      throw new Error('这是一个真实目录，为避免误删图片，请手动在 raw 下删除');
    }
    try {
      fs.unlinkSync(target);
    } catch {
      fs.rmdirSync(target);
    }
  }

  const cfg = readLibraryConfig(dataRoot);
  if (cfg.volumes?.[volume]) {
    delete cfg.volumes[volume];
    writeLibraryConfig(dataRoot, cfg);
  }
  return { removed: true, warnings };
}

/** 指定某卷的「语言 → 目录」映射；传 null 表示恢复自动识别 */
export function setVolumeDirs(
  rawRoot: string,
  dataRoot: string,
  volume: string,
  dirs: Partial<Record<Lang, string | null>>,
): void {
  const volumePath = path.join(rawRoot, volume);
  if (!fs.existsSync(volumePath)) throw new Error(`卷不存在：${volume}`);
  const existing = new Set(listDirs(volumePath));
  const clean: Partial<Record<Lang, string>> = {};
  for (const lang of LANGUAGES) {
    const dir = dirs[lang];
    if (!dir) continue;
    if (!existing.has(dir)) throw new Error(`「${dir}」不是 ${volume} 下的子目录`);
    clean[lang] = dir;
  }
  const cfg = readLibraryConfig(dataRoot);
  const volumes = { ...(cfg.volumes ?? {}) };
  if (Object.keys(clean).length) volumes[volume] = { dirs: clean };
  else delete volumes[volume];
  writeLibraryConfig(dataRoot, { ...cfg, volumes });
}
