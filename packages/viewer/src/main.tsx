import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, SESSION_KEY } from "./App.tsx";
import "./styles.css";
import "./page.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App storageKey={SESSION_KEY} />
    </StrictMode>,
  );
}
