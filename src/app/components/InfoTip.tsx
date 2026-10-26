"use client";

import { HelpCircle } from "lucide-react";

/** The accessible label carries the caveat; the bubble is its visual presentation. */
export function InfoTip({ label }: { label: string }) {
  return (
    <span className="group/tip relative inline-flex">
      <button type="button" className="grid size-6 cursor-help place-items-center rounded-full text-muted-foreground hover:text-foreground" aria-label={label}>
        <HelpCircle size={15} aria-hidden="true" />
      </button>
      <span className="pointer-events-none invisible absolute top-full right-0 z-70 mt-2 w-60 rounded-md bg-foreground p-3 text-left text-xs text-background
        group-hover/tip:visible group-focus-within/tip:visible"
        role="tooltip" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
