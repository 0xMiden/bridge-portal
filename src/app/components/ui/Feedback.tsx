import type { ComponentProps } from "react";

export function FormAlert({ compact = false, className = "", ...props }: ComponentProps<"p"> & { compact?: boolean }) {
  return <p role="alert" {...props} className={`form-error rounded-md bg-danger-soft p-3 text-sm text-danger-foreground wrap-anywhere ${compact ? "mb-3" : "mt-3"} ${className}`} />;
}

export function EmptyState({ className = "", ...props }: ComponentProps<"section">) {
  return <section {...props} className={`mx-auto my-20 w-full max-w-130 space-y-3 rounded-lg bg-surface p-5 text-center [&_p]:text-muted-foreground ${className}`} />;
}
