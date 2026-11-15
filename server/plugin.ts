import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createMangaHandler } from './app.ts';

type Next = () => void;
type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

/**
 * Vite adapter: mounts the local API on the dev / preview server.
 * All routes live in server/app.ts; the Electron desktop app reuses the same handlers.
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
