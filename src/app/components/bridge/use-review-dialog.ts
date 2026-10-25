import { useEffect, useEffectEvent, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";

const MOBILE_QUERY = "(max-width: 640px)";
function subscribeToMobile(onChange: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;
const serverIsMobile = () => false;

/** Mounted only during review: lock scrolling, contain focus, then restore both. */
export function useReviewDialog(onCancel: () => void) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const mobile = useSyncExternalStore(subscribeToMobile, isMobile, serverIsMobile);
  const cancel = useEffectEvent(onCancel);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => confirmRef.current?.focus());
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") cancel();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
      });
    };
  }, []);

  useEffect(() => {
    const body = document.body;
    const previous = {
      overflow: body.style.overflow, position: body.style.position,
      top: body.style.top, left: body.style.left, width: body.style.width,
      overlayOpen: body.dataset.overlayOpen, scrollX: window.scrollX, scrollY: window.scrollY,
    };
    body.dataset.overlayOpen = "true";
    body.style.overflow = "hidden";
    if (mobile) {
      body.style.position = "fixed";
      body.style.top = `${-previous.scrollY}px`;
      body.style.left = `${-previous.scrollX}px`;
      body.style.width = "100%";
    }
    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.width = previous.width;
      if (previous.overlayOpen === undefined) delete body.dataset.overlayOpen;
      else body.dataset.overlayOpen = previous.overlayOpen;
      if (mobile) window.scrollTo(previous.scrollX, previous.scrollY);
    };
  }, [mobile]);

  return { confirmRef, onKeyDown: containFocus };
}

function containFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
