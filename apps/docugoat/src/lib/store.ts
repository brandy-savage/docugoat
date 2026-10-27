// Where an envelope lives. Carried inside signer links so one site serves any store:
// a public relay anyone can use, or a GitHub repo the sender owns.
export type Store =
  | { kind: "relay"; url: string }
  | { kind: "github"; owner: string; repo: string; token?: string };

export function storeLabel(s: Store): string {
  return s.kind === "relay" ? `relay ${s.url.replace(/^https?:\/\//, "")}` : `GitHub ${s.owner}/${s.repo}`;
}

/** Fragment params: s=relay&u=<url>  |  s=github&o=<owner>&p=<repo>[&t=<token>] */
export function storeToParams(s: Store, p = new URLSearchParams()): URLSearchParams {
  if (s.kind === "relay") { p.set("s", "relay"); p.set("u", s.url); }
  else { p.set("s", "github"); p.set("o", s.owner); p.set("p", s.repo); if (s.token) p.set("t", s.token); }
  return p;
}

export function storeFromParams(p: URLSearchParams): Store | null {
  const s = p.get("s");
  if (s === "relay" && p.get("u")) return { kind: "relay", url: p.get("u")!.replace(/\/$/, "") };
  if (s === "github" && p.get("o") && p.get("p")) return { kind: "github", owner: p.get("o")!, repo: p.get("p")!, token: p.get("t") ?? undefined };
  // Legacy links carried only the GitHub token; the build default supplies owner/repo.
  if (p.get("t")) return { kind: "github", owner: "", repo: "", token: p.get("t")! };
  return null;
}

export const sameStore = (a: Store, b: Store) =>
  a.kind === b.kind && (a.kind === "relay" ? a.url === (b as any).url : a.owner === (b as any).owner && a.repo === (b as any).repo);
