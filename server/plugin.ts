import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createMangaHandler } from './app.ts';

type Next = () => void;
type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

/**
 * Vite 适配层：把本地接口挂到 dev / preview 服务器上。
 * 具体路由全部在 server/app.ts，桌面端（Electron）复用同一套处理逻辑。
 */
export function mangaServer(rootDir: string): Plugin {
  const attach = (use: (fn: Middleware) => void) => {
    const handler = createMangaHandler({ rootDir });
    use((req, res, next) => {
      void handler(req, res)
        .then((handled) => {
          if (!handled) next();
        })
        .catch(next);
    });
  };

  return {
    name: 'manga-memo-local-server',
    configureServer(server) {
      attach((fn) => server.middlewares.use(fn));
    },
    configurePreviewServer(server) {
      attach((fn) => server.middlewares.use(fn));
    },
  };
}
