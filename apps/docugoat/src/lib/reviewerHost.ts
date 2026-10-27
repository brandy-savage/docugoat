// Mounts the Contract Reviewer (plain-DOM app) inside a shadow root so its stylesheet stays scoped,
// and exposes the little API the signing flow needs. The CSS text is passed in so this module stays
// free of bundler-only imports and can run under plain Node for tests.
import { ReviewStore } from "@docugoat/reviewer/storage/store";
import { App } from "@docugoat/reviewer/ui/app";

export interface ReviewerHandle {
  app: App;
  shadow: ShadowRoot;
  destroy(): void;
}

export interface MountOptions {
  css: string;
  sampleUrl: string;
  onSession: (name: string | null) => void;
}

export async function mountReviewer(host: HTMLElement, opts: MountOptions): Promise<ReviewerHandle> {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.innerHTML = "";
  const style = document.createElement("style");
  // The reviewer styles html/body for a whole page; inside a shadow tree those become :host.
  style.textContent = opts.css
    .replace(/:root\s*\{/g, ":host {")
    .replace(/(^|[\s,])html\s*,/g, "$1")
    .replace(/(^|[\s}])body\s*\{/g, "$1:host {")
    + "\n:host{display:block;min-height:70vh;color-scheme:light;}";
  shadow.appendChild(style);
  const root = document.createElement("div");
  root.id = "app";
  shadow.appendChild(root);
  const store = await ReviewStore.open();
  const app = new App(root, store, { sampleUrl: opts.sampleUrl });
  const off = app.onSessionChange(opts.onSession);
  await app.start();
  opts.onSession(app.openDocumentName);
  return { app, shadow, destroy: () => { off(); shadow.innerHTML = ""; } };
}
