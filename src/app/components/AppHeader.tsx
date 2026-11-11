"use client";

import { FaucetMenu } from "./FaucetMenu";
import { useBridgeEnvironment, useNetworkSelectionLocked } from "./NetworkProvider";
import { NetworkSelect } from "./NetworkSelect";
import { ThemeToggle } from "./ThemeToggle";
import { PageHeader } from "./ui/PageLayout";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppHeader() {
  const environment = useBridgeEnvironment();
  const networkDisabled = useNetworkSelectionLocked();
  const pathname = usePathname();
  return (
    <PageHeader>
      <nav aria-label="Main navigation">
        <Link href="/recovery" aria-current={pathname === "/recovery" ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground aria-[current=page]:text-foreground">Recovery</Link>
      </nav>
      <NetworkSelect disabled={networkDisabled} />
      {environment === "testnet" ? <FaucetMenu /> : null}
      <ThemeToggle />
    </PageHeader>
  );
}
