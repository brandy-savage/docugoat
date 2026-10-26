import simpleGit, { SimpleGit } from "simple-git";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.cwd(), "data", "relay");
export const ENVELOPES_DIR = path.join(DATA_DIR, "envelopes");

let repoReady: Promise<SimpleGit> | null = null;

export function getRepo(): Promise<SimpleGit> {
  if (!repoReady) repoReady = ensureRepo();
  return repoReady;
}

async function ensureRepo(): Promise<SimpleGit> {
  fs.mkdirSync(ENVELOPES_DIR, { recursive: true });
  // Every commit passes an explicit message, so an inherited GIT_EDITOR is harmless.
  const git = simpleGit({ baseDir: DATA_DIR, unsafe: { allowUnsafeEditor: true } });
  // checkIsRepo() is true for any subdirectory of a parent repo; look for our own .git.
  if (!fs.existsSync(path.join(DATA_DIR, ".git"))) {
    await git.init();
    await git.addConfig("user.name", "docugoat-relay");
    await git.addConfig("user.email", "relay@docugoat.local");
    fs.writeFileSync(path.join(ENVELOPES_DIR, ".gitkeep"), "");
    await git.add(["-A"]);
    await git.commit("Initialize relay store");
  }
  return git;
}

// Serialize commits: concurrent `add -A && commit` calls would race on the index.
let chain: Promise<unknown> = Promise.resolve();
export function commit(message: string): Promise<string> {
  const run = chain.then(async () => {
    const git = await getRepo();
    await git.add(["-A"]);
    const result = await git.commit(message);
    return result.commit;
  });
  chain = run.catch(() => undefined);
  return run;
}
