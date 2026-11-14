// Electron 主进程：启动本地后端（同时托管打包后的前端），再用窗口加载。
// 数据目录（raw/ data/ exports/）默认放在用户目录，可用 Ctrl+Shift+D 切换；源码运行时沿用项目目录。
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PRODUCT_NAME = 'KomaYomi';

// 产品更名为 KomaYomi，但沿用旧的 userData 目录（%APPDATA%/manga-memo），
// 避免已有用户丢失数据目录配置。待迁移方案确定后再改名。
app.setName(PRODUCT_NAME);
app.setPath('userData', path.join(app.getPath('appData'), 'manga-memo'));

const ROOT = path.resolve(__dirname, '..');
const IS_DEV_RUN = Boolean(process.defaultApp); // 用 `electron .` 从源码启动
let server = null;

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function ensureDataRoot(dir) {
  for (const sub of ['raw', 'data', 'exports']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}

const defaultDataRoot = () => path.join(app.getPath('userData'), 'library');

/** 把旧数据目录里的标注（不含缩略图缓存）合并到新目录，避免丢失已做的批注/分格 */
function migrateAnnotations(from, to) {
  const parts = ['pages', 'templates', 'presets'];
  let copied = 0;
  for (const part of parts) {
    const src = path.join(from, part);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(to, part);
    fs.mkdirSync(dst, { recursive: true });
    try {
      fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
      copied += 1;
    } catch (err) {
      console.error(`[komayomi] 迁移 ${part} 失败：`, err);
    }
  }
  return copied;
}

async function pickFolder(win) {
  const res = await dialog.showOpenDialog(win ?? null, {
    title: '选择数据目录（包含 raw / data / exports）',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
}

async function resolveDataRoot() {
  if (process.env.MANGA_DATA_DIR) return ensureDataRoot(path.resolve(process.env.MANGA_DATA_DIR));

  const cfg = readConfig();
  if (cfg.dataRoot && fs.existsSync(cfg.dataRoot)) return ensureDataRoot(cfg.dataRoot);

  // 源码运行（npm run desktop）：沿用项目目录，保持原有用法
  if (IS_DEV_RUN) {
    writeConfig({ dataRoot: ROOT });
    return ensureDataRoot(ROOT);
  }

  const fallback = ensureDataRoot(defaultDataRoot());
  const hasData = fs.existsSync(path.join(fallback, 'raw'));

  if (!hasData) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: '选择数据目录',
      message: 'KomaYomi 需要一个目录来放漫画图片和标注',
      detail:
        `默认目录：${fallback}\n\n` +
        '· 想把图片放在别处（例如已有的项目目录），选「选择已有目录」\n' +
        '· 目录结构为 raw/卷名/语言/页码.jpg，data/ 存标注',
      buttons: ['选择已有目录…', '使用默认目录', '退出'],
      defaultId: 1,
      cancelId: 2,
    });
    if (response === 2) {
      app.quit();
      return null;
    }
    if (response === 0) {
      const dir = await pickFolder();
      if (dir) {
        writeConfig({ dataRoot: dir });
        return ensureDataRoot(dir);
      }
    }
    writeConfig({ dataRoot: fallback });
    // 如果安装目录旁带有旧的标注数据，顺手迁移过来
    const legacyData = path.join(ROOT, 'data');
    if (fs.existsSync(legacyData)) migrateAnnotations(legacyData, fallback);
  }

  return fallback;
}

async function createWindow() {
  const dataRoot = await resolveDataRoot();
  if (!dataRoot) return;

  // dist-server/app.mjs 由 `npm run server:build` 生成（打包了 server/*.ts 与依赖）
  const mod = await import(pathToFileURL(path.join(ROOT, 'dist-server', 'app.mjs')).href);
  const wanted = Number(process.env.MANGA_PORT) || 0;
  const started = await mod.startMangaServer(dataRoot, wanted, path.join(ROOT, 'dist'));
  server = started.server;
  console.log(`[komayomi] http://127.0.0.1:${started.port}  data=${dataRoot}`);

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0c0e12',
    title: PRODUCT_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.setMenuBarVisibility(false);
  win.setTitle(`${PRODUCT_NAME} — ${dataRoot}`);

  // 外部链接交给系统浏览器，避免在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(`http://127.0.0.1:${started.port}`)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Ctrl+Shift+D 切换数据目录（重启生效）
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'd') {
      event.preventDefault();
      void (async () => {
        const dir = await pickFolder(win);
        if (!dir) return;
        writeConfig({ ...readConfig(), dataRoot: dir });
        app.relaunch();
        app.exit(0);
      })();
    }
  });

  await win.loadURL(`http://127.0.0.1:${started.port}/`);

  // 冒烟测试用：MANGA_SMOKE=毫秒 时截图并自动退出
  const smoke = Number(process.env.MANGA_SMOKE);
  if (smoke > 0) {
    setTimeout(async () => {
      try {
        const os = require('node:os');
        const image = await win.webContents.capturePage();
        const out = process.env.MANGA_SMOKE_SHOT || path.join(os.tmpdir(), 'manga-electron-smoke.png');
        fs.writeFileSync(out, image.toPNG());
        console.log(`[komayomi] smoke shot -> ${out}`);
      } catch (err) {
        console.error('[komayomi] 截图失败', err);
      }
      app.quit();
    }, smoke);
  }
}

app
  .whenReady()
  .then(createWindow)
  .catch((err) => {
    console.error('启动失败：', err);
    dialog.showErrorBox('启动失败', String(err));
    app.quit();
  });

// 渲染进程通过 preload 调用：选择本地文件夹（添加漫画 / 切换数据目录）
ipcMain.handle('pick-folder', async (_event, title) => {
  const res = await dialog.showOpenDialog({
    title: typeof title === 'string' && title ? title : '选择文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

app.on('window-all-closed', () => {
  server?.close();
  app.quit();
});
