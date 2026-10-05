import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Landing } from "./pages/Landing";
import { Compose } from "./pages/Compose";
import { Share } from "./pages/Share";
import { EnvelopePage } from "./pages/Envelope";
import { Vault } from "./pages/Vault";
import { Security } from "./pages/Security";
import { InsecureContext } from "./components/InsecureContext";
import { Account } from "./pages/Account";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/new", element: <Compose /> },
      { path: "/share/:id", element: <Share /> },
      { path: "/d/:id", element: <EnvelopePage /> },
      { path: "/vault", element: <Vault /> },
      { path: "/security", element: <Security /> },
      { path: "/account", element: <Account /> },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" });

const secure = typeof window !== "undefined" && window.isSecureContext && !!globalThis.crypto?.subtle;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {secure ? <RouterProvider router={router} /> : <InsecureContext />}
  </StrictMode>,
);
