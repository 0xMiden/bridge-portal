"use client";

import { usePathname, useRouter } from "next/navigation";
import { CircleDashed, Globe2 } from "lucide-react";
import { useBridgeEnvironment, useSelectBridgeEnvironment } from "./NetworkProvider";
import { isBridgeEnvironment } from "../../config/environment";
import { ListboxSelect } from "./ListboxSelect";

const networks = [
  { value: "mainnet", label: "Mainnet", Icon: Globe2 },
  { value: "testnet", label: "Testnet", Icon: CircleDashed },
] as const;

/** Session storage keeps each tab's choice independent, without changing URLs. */
export function NetworkSelect({ disabled = false }: { disabled?: boolean }) {
  const environment = useBridgeEnvironment();
  const selectEnvironment = useSelectBridgeEnvironment();
  const pathname = usePathname();
  const router = useRouter();
  const selected = networks.find(network => network.value === environment)!;
  const SelectedIcon = selected.Icon;
  return (
    <ListboxSelect
      kind="network"
      label="Bridge network"
      menuLabel="Bridge network"
      heading="Bridge network"
      value={environment}
      disabled={disabled}
      options={networks.map(({ value, label, Icon }) => ({
        value,
        label,
        content: <><Icon className="network-option-icon" size={18} aria-hidden="true" /><span>{label}</span></>,
      }))}
      onChange={next => {
        if (isBridgeEnvironment(next) && next !== environment) {
          selectEnvironment(next);
          if (pathname !== "/") router.push("/");
        }
      }}
    >
      <SelectedIcon className="network-symbol" size={17} aria-hidden="true" />
      <span>{selected.label}</span>
    </ListboxSelect>
  );
}
