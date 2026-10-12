/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional override for the RMF trajectory server websocket URL. */
  readonly VITE_TRAJECTORY_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
