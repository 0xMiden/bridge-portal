import type { ComponentProps } from "react";

const variants = {
  form: "rounded-3xl p-4",
  receipt: "rounded-lg p-6 mobile:p-4",
  empty: "rounded-3xl px-6 py-12 text-center",
};

/** Shared bordered surfaces; an empty route keeps only its action visible. */
export function Card({ as: Tag = "section", variant = "form", plain = false, className = "", ...props }: ComponentProps<"section"> & {
  as?: "section" | "article";
  variant?: keyof typeof variants;
  plain?: boolean;
}) {
  return <Tag {...props} className={`w-full min-w-0 ${plain ? "" : `border border-border bg-surface ${variants[variant]}`} ${className}`} />;
}
