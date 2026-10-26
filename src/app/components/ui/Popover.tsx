"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { floatingSurfaceClasses, useSurface } from "./Surface";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className = "", ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  const surface = useSurface();
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content data-surface={surface} sideOffset={8} collisionPadding={12} className={`${floatingSurfaceClasses} max-h-(--radix-popover-content-available-height) ${className}`} {...props} />
  </PopoverPrimitive.Portal>;
}
