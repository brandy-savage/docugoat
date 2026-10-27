// Mounts the Contract Reviewer (plain-DOM app) inside a shadow root so its stylesheet stays scoped,
// and exposes the little API the signing flow needs.
import reviewerCss from "@docugoat/reviewer/style.css?raw";
import { ReviewStore } from "@docugoat/reviewer/storage/store";
import { App } from "@docugoat/reviewer/ui/app";

export interface ReviewerHandle {
  app: App;
  destroy(): void;
}

export async function mountReviewer(host: HTMLElement, onSession: (name: string | null) => void): Promise<ReviewerHandle> {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.innerHTML = "";
  const style = document.createElement("style");
  // The reviewer styles :root/body for a whole page; inside a shadow tree those become :host.
  style.textContent = reviewerCss.replace(/:root\s*\{/g, ":host {").replace(/(^|\n)body\s*\{/g, "$1:host {") + "\n:host{display:block;min-height:70vh;color-scheme:light;}";
  shadow.appendChild(style);
  const root = document.createElement("div");
  root.id = "app";
  shadow.appendChild(root);
  const store = await ReviewStore.open();
  const app = new App(root, store);
  const off = app.onSessionChange(onSession);
  await app.start();
  onSession(app.openDocumentName);
  return { app, destroy: () => { off(); shadow.innerHTML = ""; } };
}
