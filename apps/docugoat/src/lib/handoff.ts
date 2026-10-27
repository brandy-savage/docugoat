// In-memory hand-off from the review stage to the seal stage (bytes never touch storage or the URL).
export interface Handoff { name: string; bytes: Uint8Array; mode: "tracked" | "clean" }
let pending: Handoff | null = null;
export const setHandoff = (h: Handoff | null) => { pending = h; };
export const takeHandoff = (): Handoff | null => pending;
