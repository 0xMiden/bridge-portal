"use client";

import { HelpCircle } from "lucide-react";

/**
 * A small "?" affordance that reveals a text bubble on hover/focus — for
 * contextual caveats that don't warrant their own always-on row. The full text
 * is the trigger's accessible label, so screen readers get it without the
 * hover; the bubble is the visual presentation.
 */
export function InfoTip({ label }: { label: string }) {
  return (
    <span className="info-tip">
      <button type="button" className="info-tip-trigger" aria-label={label}>
        <HelpCircle size={15} aria-hidden="true" />
      </button>
      <span className="info-tip-bubble" role="tooltip" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
