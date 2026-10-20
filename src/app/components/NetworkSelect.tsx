"use client";

import { usePathname, useRouter } from "next/navigation";
import { useBridgeEnvironment, useSelectBridgeEnvironment } from "./NetworkProvider";
import { isBridgeEnvironment } from "../../config/environment";

/** Session storage keeps each tab's choice independent, without changing URLs. */
export function NetworkSelect({ disabled = false }: { disabled?: boolean }) {
  const environment = useBridgeEnvironment();
  const selectEnvironment = useSelectBridgeEnvironment();
  const pathname = usePathname();
  const router = useRouter();
  return (
    <label className="network-selector">
      <span className="sr-only">Bridge network</span>
      <select aria-label="Bridge network" value={environment} disabled={disabled}
        onChange={event => {
          const next = event.target.value;
          if (isBridgeEnvironment(next) && next !== environment) {
            selectEnvironment(next);
            if (pathname !== "/") router.push("/");
          }
        }}>
        <option value="mainnet">Mainnet</option>
        <option value="testnet">Testnet</option>
      </select>
    </label>
  );
}
