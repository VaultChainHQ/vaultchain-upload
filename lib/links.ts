// Cross-site links. The four sites share one brand and one header, so each knows where the others live.
export const SITES = {
  home: "https://vaultchain-web.vercel.app",
  docs: "https://vaultchain-web.vercel.app/docs",
  vault: "https://vaultchain-web.vercel.app/vault",
  explorer: "https://vaultchain-explorer.vercel.app",
  upload: "https://vaultchain-upload.vercel.app",
} as const;

export const ORG_URL = "https://github.com/VaultChainHQ";
export const REPOS = {
  chain: `${ORG_URL}/vaultchain`,
  web: `${ORG_URL}/vaultchain-web`,
  upload: `${ORG_URL}/vaultchain-upload`,
  explorer: `${ORG_URL}/vaultchain-explorer`,
} as const;

/** Deep link into the upload app's file library, opened on one file. */
export const uploadFileUrl = (root: string) => `${SITES.upload}/files?open=${root}`;
export const docsUrl = (path: string) => `${SITES.docs}/${path}`;
/** A file's page in the explorer. */
export const explorerFileUrl = (root: string) => `${SITES.explorer}/files/${root}`;
