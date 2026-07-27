import type { PropsWithChildren } from "react";
import { BatteryMedium, Navigation, Radio, Signal } from "lucide-react";

import { useLocale } from "../i18n";
import { BrandMark } from "./BrandMark";
import { PreferencesBar } from "./PreferencesBar";

export function AuthLayout({ children }: PropsWithChildren) {
  const { copy } = useLocale();

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="RETFAST preview">
        <div className="story-glow story-glow-one" />
        <div className="story-glow story-glow-two" />
        <BrandMark />

        <div className="story-copy">
          <div className="eyebrow">
            <span className="live-dot" />
            {copy.liveStatus}
          </div>
          <h1>{copy.brandTagline}</h1>
          <p>{copy.brandDescription}</p>
        </div>

        <div className="operation-preview" aria-hidden="true">
          <div className="preview-map-grid" />
          <svg viewBox="0 0 540 250" className="route-line">
            <path d="M54 185 C 144 114, 198 187, 274 117 S 412 86, 486 46" />
          </svg>
          <div className="map-pin pilot-pin">
            <Navigation size={16} fill="currentColor" />
          </div>
          <div className="map-pin vehicle-pin">
            <Radio size={15} />
          </div>
          <div className="pilot-chip">
            <span className="avatar">MK</span>
            <span>
              <strong>Mert Kaya</strong>
              <small>{copy.pilot} · 1,842 m</small>
            </span>
            <Signal size={15} />
          </div>
          <div className="vehicle-chip">
            <span className="vehicle-icon">
              <Navigation size={14} />
            </span>
            <span>
              <strong>R-07</strong>
              <small>{copy.retriever} · 3/5</small>
            </span>
            <BatteryMedium size={17} />
          </div>
        </div>

        <div className="story-footer">
          <span>XC Open 2026 · Çameli</span>
          <span className="connected-label">
            <i /> {copy.connected}
          </span>
        </div>
      </section>

      <section className="auth-panel">
        <header className="mobile-auth-header">
          <BrandMark compact />
          <PreferencesBar />
        </header>
        <div className="desktop-preferences">
          <PreferencesBar />
        </div>
        <div className="auth-card">{children}</div>
        <p className="auth-legal">© 2026 RETFAST · Safety through coordination</p>
      </section>
    </main>
  );
}
