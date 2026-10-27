// Links carry their store: round-trip both kinds and confirm legacy token-only links still resolve.
import assert from "node:assert/strict";
import { storeFromParams, storeToParams } from "../src/lib/store";
const relay = { kind: "relay" as const, url: "https://relay.example.com" };
const gh = { kind: "github" as const, owner: "alice", repo: "contracts", token: "github_pat_x" };
for (const s of [relay, gh]) {
  const p = storeToParams(s, new URLSearchParams({ k: "frag" }));
  assert.deepEqual(storeFromParams(new URLSearchParams(p.toString())), s);
  assert.equal(new URLSearchParams(p.toString()).get("k"), "frag");
}
assert.deepEqual(storeFromParams(new URLSearchParams("k=frag&t=tok")), { kind: "github", owner: "", repo: "", token: "tok" });
assert.equal(storeFromParams(new URLSearchParams("k=frag")), null);
console.log("✓ store params round-trip (relay, github, legacy)");
