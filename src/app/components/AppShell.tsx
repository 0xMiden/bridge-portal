import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { PageShell } from "./ui/PageLayout";
import { BridgeSurface } from "./ui/Surface";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <BridgeSurface>
      <PageShell className="app-shell bridge-portal" data-surface="bridge">
        <AppHeader />
        <main className="flex flex-1 flex-col">{children}</main>
      </PageShell>
    </BridgeSurface>
  );
}
