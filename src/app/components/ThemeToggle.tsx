"use client";

import { IconButton } from "./ui/Button";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/Menu";

const choices = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const isOpen = useRef(false);

  function changeOpen(next: boolean) {
    isOpen.current = next;
    setOpen(next);
  }

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => selectedRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const selected = choices.find(choice => mounted && choice.value === theme) ?? choices[2];
  const Icon = selected.Icon;

  return (
      <Menu open={open} onOpenChange={changeOpen}>
        <MenuTrigger asChild>
          <IconButton ref={triggerRef} className="theme-trigger" type="button" aria-label={`Theme: ${selected.label}`}>
            {mounted ? <Icon size={18} aria-hidden="true" /> : <span className="size-4.5" aria-hidden="true" />}
          </IconButton>
        </MenuTrigger>
        <MenuContent size="small" aria-label="Theme" onCloseAutoFocus={event => {
          event.preventDefault();
          // A quick reopen must not be dismissed by the previous close's focus restoration.
          if (!isOpen.current) triggerRef.current?.focus();
        }}>
          <MenuRadioGroup value={selected.value} onValueChange={setTheme} onKeyDown={event => {
            // Retain the theme control's existing horizontal arrow shortcuts.
            const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
            const index = items.indexOf(event.target as HTMLButtonElement);
            items[(index + step + items.length) % items.length]?.focus();
          }}>
            {choices.map(({ value, label, Icon: ChoiceIcon }) => (
              <MenuRadioItem key={value} value={value} asChild>
                <button ref={value === selected.value ? selectedRef : undefined} type="button" className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:-outline-offset-2">
                  <ChoiceIcon size={17} aria-hidden="true" />
                  <span>{label}</span>
                  {value === selected.value && <Check className="ml-auto text-accent" size={16} aria-hidden="true" />}
                </button>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
  );
}
