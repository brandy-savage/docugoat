// import.meta.env only exists under Vite; tests run the same modules under tsx.
const E: Record<string, string | undefined> = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
export const env = (name: string, fallback = ""): string => E[name] ?? fallback;
export const BASE_URL = env("BASE_URL", "/");
