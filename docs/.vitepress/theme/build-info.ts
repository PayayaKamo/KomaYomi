// Values are replaced at build time by `vite.define` in config.mts.
declare const __BUILD_SHA_SHORT__: string
declare const __BUILD_SHA_FULL__: string
declare const __BUILD_TIME__: string

export const buildInfo = {
  shaShort: __BUILD_SHA_SHORT__,
  shaFull: __BUILD_SHA_FULL__,
  time: __BUILD_TIME__,
}
