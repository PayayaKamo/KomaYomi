export {};

declare global {
  interface Window {
    /** Desktop bridge injected by Electron; undefined in the browser. */
    mangaDesktop?: {
      pickFolder: (title?: string) => Promise<string | null>;
      /** Native picker for a .mnproj; the returned absolute path is opened by the server. */
      pickProjectFile: (title?: string) => Promise<string | null>;
      /** Native save dialog for a "save as" copy; returns the chosen absolute path. */
      saveProjectFile: (title?: string, defaultName?: string) => Promise<string | null>;
      platform: string;
    };
  }
}
