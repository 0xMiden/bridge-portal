import Image from "next/image";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Layout = "detail" | "bridge";

export function PageShell({ variant = "detail", className = "", ...props }: ComponentProps<"main"> & { variant?: Layout }) {
  const spacing = variant === "bridge" ? "px-6 mobile:px-3"
    : `max-w-295 p-4
       mobile:pt-[max(12px,env(safe-area-inset-top))] mobile:pr-[max(12px,env(safe-area-inset-right))]
       mobile:pb-[max(12px,env(safe-area-inset-bottom))] mobile:pl-[max(12px,env(safe-area-inset-left))]`;
  return <main {...props} className={`relative z-1 mx-auto flex min-h-dvh w-full flex-col ${spacing} ${className}`} />;
}

export function PageHeader({ variant, children, action }: { variant: Layout; children: ReactNode; action?: ReactNode }) {
  const bridge = variant === "bridge";
  const layout = bridge ? "topbar min-h-20 border-b border-border" : "detail-topbar min-h-16";
  return (
    <header className={`flex flex-wrap items-center gap-3 py-3 ${layout}`}>
      <Link className="flex min-w-0 flex-1 items-center gap-2.5" href="/" aria-label={bridge ? "Miden bridge home" : "Back to bridge"}>
        <Image className="w-28 min-w-0 dark:invert dark:hue-rotate-180"
          src="/miden-logo-horizontal.svg" alt="Miden" width={112} height={34} priority />
        <span className="border-l border-border pl-2.5 text-sm text-muted-foreground mobile:hidden">Bridge</span>
      </Link>
      <div className="flex items-center gap-2">
        {children}
      </div>
      {action && <div className="ml-auto mobile:w-full mobile:text-right">{action}</div>}
    </header>
  );
}
