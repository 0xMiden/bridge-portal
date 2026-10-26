import Link from "next/link";
import type { ComponentProps } from "react";

const variants = {
  primary: "w-full rounded-md bg-primary px-4 text-primary-foreground hover:not-disabled:brightness-110",
  bridge: "w-full rounded-xl bg-[#ff650a] px-4 text-[#211307] hover:not-disabled:bg-[#f5813d]",
  secondary: "rounded-md bg-field px-3.5 text-foreground hover:shadow-(--shadow-raised)",
  toolbar: "rounded-md bg-surface px-3.5 text-foreground shadow-(--shadow-control) hover:shadow-(--shadow-raised)",
};
type Variant = keyof typeof variants;
type ButtonStyle = { variant?: Variant };

function buttonClassName(variant: Variant, className: string) {
  const height = variant === "primary" || variant === "bridge" ? "min-h-12" : "min-h-11";
  return `inline-flex items-center justify-center gap-2 text-sm font-semibold transition disabled:opacity-60
    ${variants[variant]} ${height} ${className}`;
}

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & ButtonStyle) {
  return <button {...props} className={buttonClassName(variant, className)} />;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & ButtonStyle) {
  return <Link {...props} className={buttonClassName(variant, className)} />;
}

export function ButtonAnchor({ variant = "primary", className = "", ...props }: ComponentProps<"a"> & ButtonStyle) {
  return <a {...props} className={buttonClassName(variant, className)} />;
}

export function IconButton({ tone = "neutral", className = "", ...props }: ComponentProps<"button"> & { tone?: "neutral" | "accent" }) {
  const color = tone === "accent" ? "hover:text-accent aria-expanded:text-accent" : "hover:text-foreground aria-expanded:text-foreground";
  return <button type="button" {...props} className={`inline-grid size-11 flex-none place-items-center rounded-md bg-surface p-0 text-muted-foreground
    shadow-(--shadow-control) transition hover:bg-surface-muted aria-expanded:bg-surface-muted ${color} ${className}`} />;
}
