"use client";

import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { floatingSurfaceClasses, useSurface } from "./Surface";

export function Menu(props: ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root modal={false} {...props} />;
}

export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuRadioGroup = MenuPrimitive.RadioGroup;
export const MenuRadioItem = MenuPrimitive.RadioItem;

export function MenuContent({ size = "default", className = "", ...props }: ComponentProps<typeof MenuPrimitive.Content> & {
  size?: "default" | "small";
}) {
  const surface = useSurface();
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content data-surface={surface} align="end" sideOffset={8} collisionPadding={12}
        loop className={`${floatingSurfaceClasses} grid max-h-(--radix-dropdown-menu-content-available-height) gap-1 ${size === "small" ? "w-42" : "w-76"} ${className}`} {...props} />
    </MenuPrimitive.Portal>
  );
}

/** asChild preserves native links/buttons; copy and refresh actions can stay open. */
export function MenuItem({ keepOpen = false, onSelect, ...props }: ComponentProps<typeof MenuPrimitive.Item> & { keepOpen?: boolean }) {
  return <MenuPrimitive.Item asChild {...props} onSelect={event => {
    onSelect?.(event);
    if (keepOpen) event.preventDefault();
  }} />;
}
