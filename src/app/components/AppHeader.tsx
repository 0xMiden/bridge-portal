"use client";

import { FaucetMenu } from "./FaucetMenu";
import { useBridgeEnvironment, useNetworkSelectionLocked } from "./NetworkProvider";
import { NetworkSelect } from "./NetworkSelect";
import { ThemeToggle } from "./ThemeToggle";
import { PageHeader } from "./ui/PageLayout";

export function AppHeader() {
  const environment = useBridgeEnvironment();
  const networkDisabled = useNetworkSelectionLocked();
  return (
    <PageHeader>
      <NetworkSelect disabled={networkDisabled} />
      {environment === "testnet" ? <FaucetMenu /> : null}
      <ThemeToggle />
    </PageHeader>
  );
}
