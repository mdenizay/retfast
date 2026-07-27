import { Navigation } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark" aria-label="RETFAST">
      <span className="brand-symbol" aria-hidden="true">
        <Navigation size={compact ? 17 : 20} strokeWidth={2.4} />
      </span>
      <span className="brand-word">RETFAST</span>
    </div>
  );
}
