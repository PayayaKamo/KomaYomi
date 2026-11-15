import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, guessLang, listDirs, readLibraryConfig, writeLibraryConfig } from './library.ts';
import type { Lang } from '../shared/types.ts';
import { AppError } from './errors.ts';
import { t } from './messages/index.ts';

const BAD_NAME = /[\\/:*?"<>|]/;

function assertName(name: string): string {
  const clean = name.trim();
  if (!clean) throw new AppError('ERR_DIR_NAME_EMPTY', {}, 400);
  if (BAD_NAME.test(clean) || clean === '.' || clean === '..') {
    throw new AppError('ERR_DIR_NAME_INVALID', { name: clean }, 400);
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
    if (fs.existsSync(target)) return { added: [name], warnings: [t('WARN_SAME_NAME_VOLUME')] };
    fs.mkdirSync(target, { recursive: true });
    warnings.push(t('WARN_EMPTY_VOLUME_CREATED'));
    return { added: [name], warnings };
  }

  const source = path.resolve(sourcePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new AppError('ERR_DIR_NOT_FOUND', { path: source }, 400);
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
      warnings.push(t('WARN_NO_LANGUAGE_DIR_DETECTED'));
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
        warnings.push(t('WARN_VOLUME_ALREADY_IN_LIBRARY', { name: candidate.name }));
        continue;
      }
      throw new AppError('ERR_VOLUME_EXISTS', { name: candidate.name }, 409);
    }
    try {
      fs.symlinkSync(candidate.dir, target, 'junction');
      added.push(candidate.name);
    } catch (err) {
      throw new AppError('ERR_LINK_CREATE_FAILED', { detail: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  return { added, warnings };
}

/** 从图库移除：只删 junction，绝不删除真实目录里的图片 */
export function removeVolume(
  rawRoot: string,
  dataRoot: string,
  volume: string,
): { removed: boolean; warnings: string[] } {
  const target = path.join(rawRoot, volume);
  const warnings: string[] = [];
  if (!fs.existsSync(target)) {
    warnings.push(t('WARN_VOLUME_DIR_REMOVED'));
  } else {
    const stat = fs.lstatSync(target);
    if (!stat.isSymbolicLink()) {
      throw new AppError('ERR_REAL_DIRECTORY', {}, 409);
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
  if (!fs.existsSync(volumePath)) throw new AppError('ERR_VOLUME_NOT_FOUND', { volume }, 404);
  const existing = new Set(listDirs(volumePath));
  const clean: Partial<Record<Lang, string>> = {};
  for (const lang of LANGUAGES) {
    const dir = dirs[lang];
    if (!dir) continue;
    if (!existing.has(dir)) throw new AppError('ERR_DIR_NOT_IN_VOLUME', { dir, volume }, 400);
    clean[lang] = dir;
  }
  const cfg = readLibraryConfig(dataRoot);
  const volumes = { ...(cfg.volumes ?? {}) };
  if (Object.keys(clean).length) volumes[volume] = { dirs: clean };
  else delete volumes[volume];
  writeLibraryConfig(dataRoot, { ...cfg, volumes });
}
