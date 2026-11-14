export {};

declare global {
  interface Window {
    /** Electron 注入的桌面能力；浏览器里为 undefined */
    mangaDesktop?: {
      pickFolder: (title?: string) => Promise<string | null>;
      platform: string;
    };
  }
}
