import type { ComponentProps, ReactNode } from "react";

type Detail = { label: string; value: ReactNode };

/** Quotes, reviews, and receipts share the same label/value markup. */
export function DetailsList({ items, layout = "review", children, className = "", ...props }: ComponentProps<"dl"> & {
  items: (Detail | false | null | undefined)[];
  layout?: "receipt" | "review" | "inline";
}) {
  const inline = layout === "inline";
  const spacing = inline ? "flex flex-wrap gap-x-3 gap-y-1 text-xs"
    : `grid gap-3 border-t border-border pt-5 text-sm ${layout === "receipt" ? "mt-6" : "mb-2"}`;
  return <dl {...props} className={`${spacing} ${className}`}>
    {items.map(item => item && <div className={`flex items-baseline ${inline ? "flex-wrap gap-1" : "justify-between gap-3"}`} key={item.label}>
      <dt className={inline ? undefined : "text-muted-foreground"}>{item.label}</dt>
      <dd className="min-w-0 text-right font-medium wrap-anywhere">{item.value}</dd>
    </div>)}
    {children}
  </dl>;
}
