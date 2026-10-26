"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRef, type ReactNode, type RefObject } from "react";
import { useSurface } from "./Surface";

/** Shared modal focus, dismissal, scroll locking, and responsive sheet layout. */
export function Dialog({ label, onClose, initialFocusRef, children }: {
  label: string;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const surface = useSurface();
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="preflight-overlay fixed inset-0 z-110 flex items-center justify-center bg-overlay p-6
          animate-[fade-in_200ms_ease-out] mobile:items-end mobile:p-0" data-surface={surface}>
          <DialogPrimitive.Content className="preflight-panel flex max-h-[90dvh] w-full max-w-110 flex-col gap-3 overflow-hidden rounded-[20px] bg-surface p-6 shadow-(--shadow-card) outline-none
            mobile:max-w-none mobile:rounded-b-none mobile:p-4 mobile:pb-0 mobile:animate-[sheet-in_200ms_ease-out]" aria-describedby={undefined}
            onOpenAutoFocus={event => {
              returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              if (initialFocusRef?.current && !initialFocusRef.current.disabled) {
                event.preventDefault();
                initialFocusRef.current.focus();
              }
            }}
            onCloseAutoFocus={event => {
              event.preventDefault();
              if (returnFocus.current?.isConnected) returnFocus.current.focus();
            }}>
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
