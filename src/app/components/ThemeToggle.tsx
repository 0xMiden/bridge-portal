"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const choices = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

type ThemeChoice = (typeof choices)[number]["value"];

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return choices.some((choice) => choice.value === value);
}

export function ThemeToggle({ className }: { className?: string }) {
  const { setTheme, theme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedTheme = mounted && isThemeChoice(theme) ? theme : "system";
  const selectedIndex = choices.findIndex(
    (choice) => choice.value === selectedTheme,
  );
  const selectedChoice = choices[selectedIndex];

  useEffect(() => {
    if (!open) return;

    optionRefs.current[selectedIndex]?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, selectedIndex]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const chooseTheme = (nextTheme: ThemeChoice) => {
    setTheme(nextTheme);
    closeAndRestoreFocus();
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseTheme(choices[index].value);
      return;
    }

    let nextIndex: number | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % choices.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + choices.length) % choices.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = choices.length - 1;
    }

    if (nextIndex !== undefined) {
      event.preventDefault();
      optionRefs.current[nextIndex]?.focus();
    }
  };

  const SelectedIcon = selectedChoice.Icon;

  return (
    <div
      className={["theme-menu-root", className].filter(Boolean).join(" ")}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        className="theme-trigger"
        type="button"
        aria-label={`Theme: ${selectedChoice.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        {mounted ? (
          <SelectedIcon size={18} aria-hidden="true" />
        ) : (
          <span className="theme-trigger-placeholder" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div className="theme-menu" id={menuId} role="menu" aria-label="Theme">
          {choices.map(({ value, label, Icon }, index) => {
            const checked = value === selectedTheme;
            return (
              <button
                key={value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                className="theme-menu-item"
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => chooseTheme(value)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
                <Check
                  className="theme-menu-check"
                  size={16}
                  aria-hidden="true"
                  data-visible={checked}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
