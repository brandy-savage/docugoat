/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELAY_URL?: string;
  readonly VITE_BACKEND?: string;
  readonly VITE_GH_OWNER?: string;
  readonly VITE_GH_DATA_REPO?: string;
  readonly VITE_GH_DATA_BRANCH?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
