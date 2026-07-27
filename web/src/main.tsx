import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { PreferencesProvider } from "./contexts/PreferencesContext";
import "./index.css";

const chunkRecoveryKey = "retfast:chunk-recovery";

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  if (sessionStorage.getItem(chunkRecoveryKey)) return;

  sessionStorage.setItem(chunkRecoveryKey, "pending");
  window.location.reload();
});

window.addEventListener(
  "load",
  () => sessionStorage.removeItem(chunkRecoveryKey),
  { once: true },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PreferencesProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </PreferencesProvider>
    </BrowserRouter>
  </StrictMode>,
);
