"use client";

import { createContext, useContext, type ReactNode } from "react";

// Portals keep the palette and typography of the surface that opened them.
const SurfaceContext = createContext<"bridge" | undefined>(undefined);

export function BridgeSurface({ children }: { children: ReactNode }) {
  return <SurfaceContext value="bridge">{children}</SurfaceContext>;
}

export function useSurface() {
  return useContext(SurfaceContext);
}

// The same portal surface is used by menus and selection popovers.
export const floatingSurfaceClasses = "z-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-md bg-surface-elevated p-2 shadow-(--shadow-card) outline-none animate-menu-in";
