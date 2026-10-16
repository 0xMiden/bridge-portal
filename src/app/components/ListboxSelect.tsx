"use client";

import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

/** Shared selection, focus, and dismissal behavior for bridge asset controls. */
export function ListboxSelect({
  kind, label, menuLabel, heading, context, value, options, onChange, children,
}: {
  kind: "chain" | "token";
  label: string;
  menuLabel: string;
  heading: string;
  context?: string;
  value: string;
  options: { value: string; label: string; content: ReactNode }[];
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef({ text: "", at: 0 });

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const match = searchRef.current.text
      ? buttons.find((button) => button.getAttribute("aria-label")?.toLowerCase().startsWith(searchRef.current.text))
      : undefined;
    (match ?? buttons.find((button) => button.getAttribute("aria-selected") === "true"))?.focus();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function navigateOptions(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        searchRef.current = { text: "", at: 0 };
        setOpen(true);
        return;
      }
      next = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    } else if (open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      next = event.key === "Home" ? 0 : buttons.length - 1;
    } else if (event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - searchRef.current.at < 700 ? searchRef.current.text : "";
      const key = event.key.toLowerCase();
      const text = previous === key ? key : previous + key;
      searchRef.current = { text, at: now };
      if (!open) {
        setOpen(true);
        return;
      }
      const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
      ordered.find((button) => button.getAttribute("aria-label")?.toLowerCase().startsWith(text))?.focus();
      return;
    } else {
      return;
    }
    buttons[next]?.focus();
  }

  return (
    <div
      className={`${kind}-select`}
      ref={rootRef}
      onKeyDown={navigateOptions}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        role={kind === "chain" ? "combobox" : undefined}
        className={`${kind}-select-trigger ${open ? "open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => {
          searchRef.current = { text: "", at: 0 };
          setOpen((previous) => !previous);
        }}
      >
        {children}
        <ChevronDown className="select-caret" size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className={`select-menu ${kind}-select-menu`}>
          <div className="select-menu-heading">
            <span>{heading}</span>
            {context ? <small>{context}</small> : null}
          </div>
          <div id={menuId} role="listbox" aria-label={menuLabel}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-label={option.label}
                aria-selected={option.value === value}
                tabIndex={-1}
                className={`select-option ${option.value === value ? "selected" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                {option.content}
                {option.value === value ? <Check className="select-option-check" size={16} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
