declare module 'core-js-pure/features/url/index.js' { const value: typeof URL; export default value; }
declare module 'core-js-pure/features/url-search-params/index.js' { const value: typeof URLSearchParams; export default value; }
declare module 'core-js-pure/features/structured-clone.js' { const value: typeof structuredClone; export default value; }
declare module 'core-js-pure/features/atob.js' { const value: typeof atob; export default value; }
declare module 'core-js-pure/features/btoa.js' { const value: typeof btoa; export default value; }
declare module 'core-js-pure/features/dom-exception/index.js' { const value: typeof DOMException; export default value; }
declare module '@sinonjs/text-encoding' {
  const value: { TextEncoder: typeof globalThis.TextEncoder; TextDecoder: typeof globalThis.TextDecoder };
  export default value;
}

declare module 'abort-controller/dist/abort-controller.mjs' { export { AbortController, AbortSignal } from 'abort-controller'; }
