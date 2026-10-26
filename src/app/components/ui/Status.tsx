import type { ComponentProps } from "react";

const tones = {
  success: "bg-success-soft text-success-foreground",
  warning: "bg-warning-soft text-warning-foreground",
  danger: "bg-danger-soft text-danger-foreground",
  active: "bg-accent-soft text-accent-foreground",
};

export function StatusIndicator({ tone = "", variant = "badge", className = "", ...props }: ComponentProps<"span"> & {
  tone?: string;
  variant?: "badge" | "dot";
}) {
  const shape = variant === "badge" ? "shrink-0 rounded-full px-3 py-1 text-xs font-semibold" : "size-2 shrink-0 rounded-full";
  const color = Object.hasOwn(tones, tone) ? tones[tone as keyof typeof tones] : variant === "dot" ? "bg-accent" : "bg-surface-muted text-muted-foreground";
  const pulse = variant === "dot" && tone === "active" ? "motion-safe:animate-status-pulse" : "";
  return <span {...props} data-tone={tone} className={`${shape} ${color} ${pulse} ${className}`} />;
}
