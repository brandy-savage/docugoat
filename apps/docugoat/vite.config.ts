import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// WebCrypto (everything docugoat does) only exists in secure contexts, so the dev server must be HTTPS.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss(), basicSsl({ name: "docugoat", domains: ["localhost", "100.81.174.73", "cumman-ms-7c91.tail52abd6.ts.net"] })],
  server: {
    host: true,
    port: 5183,
    https: {},
    proxy: { "/api": { target: "http://localhost:4173", xfwd: true } },
  },
});
