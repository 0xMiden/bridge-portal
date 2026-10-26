import Image from "next/image";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function PageShell({ className = "", ...props }: ComponentProps<"div">) {
  return <div {...props} className={`relative z-1 mx-auto flex min-h-dvh w-full flex-col px-6 mobile:px-3 ${className}`} />;
}

export function PageHeader({ children }: { children: ReactNode }) {
  return (
    <header className="topbar flex min-h-20 flex-wrap items-center gap-3 border-b border-border py-3">
      <Link className="flex min-w-0 flex-1 items-center gap-2.5" href="/" aria-label="Miden bridge home">
        <Image className="w-28 min-w-0 dark:invert dark:hue-rotate-180"
          src="/miden-logo-horizontal.svg" alt="Miden" width={112} height={34} priority />
        <span className="border-l border-border pl-2.5 text-sm text-muted-foreground mobile:hidden">Bridge</span>
      </Link>
      <div className="flex items-center gap-2">
        {children}
      </div>
    </header>
  );
}
