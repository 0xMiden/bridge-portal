"use client";

export const standardEase = "cubic-bezier(0.4, 0, 0.2, 1)";

/** Skip reduced motion, cancel immediately when it is enabled, and clean up on unmount. */
export function animateWithMotionPreference(build: () => Animation[]) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (preference.matches || typeof Element.prototype.animate !== "function") return;

  const animations = build();
  const cancel = () => animations.forEach(animation => animation.cancel());
  const onChange = () => {
    if (preference.matches) cancel();
  };
  preference.addEventListener("change", onChange);

  return () => {
    preference.removeEventListener("change", onChange);
    cancel();
  };
}
