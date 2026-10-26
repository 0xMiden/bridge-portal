"use client";

import { Popover, PopoverContent, PopoverTrigger } from "./ui/Popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

const variants = {
  chain: { trigger: "min-h-9 gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-[13px]/normal font-medium hover:border-border-strong data-[state=open]:border-border-strong mobile:min-h-11 mobile:gap-1 mobile:px-2 mobile:text-xs", menu: "w-72" },
  token: { trigger: "min-h-12 gap-2 rounded-full border border-border px-2.5 py-2 text-lg/normal font-semibold hover:border-border-strong data-[state=open]:border-border-strong mobile:min-h-11 mobile:py-1.5", menu: "w-80 data-[kind=token]:max-w-[calc(100vw-4rem)] data-[kind=token]:rounded-lg ring-1 ring-border" },
  network: { trigger: "min-h-11 gap-2 rounded-md px-3 text-[13px]/normal font-semibold shadow-(--shadow-control)", menu: "w-56" },
};

/** Shared selection, focus, and dismissal behavior for bridge asset controls. */
export function ListboxSelect({
  kind, label, menuLabel, heading, context, value, options, onChange, children, searchable = false, disabled = false,
}: {
  kind: "chain" | "token" | "network";
  label: string;
  menuLabel: string;
  heading: string;
  context?: string;
  searchable?: boolean;
  disabled?: boolean;
  value: string;
  options: { value: string; label: string; content: ReactNode }[];
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const variant = variants[kind];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filteredOptions = searchable
    ? options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef({ text: "", at: 0 });

  function focusOptions(event: Event) {
    event.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const match = searchRef.current.text
      ? buttons.find(button => button.getAttribute("aria-label")?.toLowerCase().startsWith(searchRef.current.text))
      : undefined;
    (searchInputRef.current ?? match ?? buttons.find(button => button.getAttribute("aria-selected") === "true") ?? buttons[0])?.focus();
  }

  function navigateOptions(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const editingSearch = event.target === searchInputRef.current;
    if (editingSearch && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        searchRef.current = { text: "", at: 0 };
        setQuery("");
        setOpen(true);
        return;
      }
      if (!buttons.length) return;
      next = index < 0
        ? event.key === "ArrowDown" ? 0 : buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
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
        setQuery("");
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
    <Popover open={open} onOpenChange={setOpen}>
      <div className="min-w-0 max-w-full shrink-0" data-kind={kind} onKeyDown={navigateOptions}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            role={kind !== "token" ? "combobox" : undefined}
            disabled={disabled}
            className={`${kind}-select-trigger group/select inline-flex max-w-full items-center bg-surface text-foreground transition
              hover:bg-surface-muted data-[state=open]:bg-surface-muted disabled:cursor-wait disabled:opacity-60 ${variant.trigger}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            aria-label={label}
            onClick={() => {
              searchRef.current = { text: "", at: 0 };
              setQuery("");
            }}
          >
            {children}
            <ChevronDown className="select-caret shrink-0 text-muted-foreground group-data-[state=open]/select:rotate-180" size={15} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          ref={menuRef}
          data-kind={kind}
          role={undefined}
          aria-labelledby={undefined}
          onOpenAutoFocus={focusOptions}
          align={kind === "token" ? "end" : "start"}
          className={`select-menu ${variant.menu}`}
        >
          <div className={`flex items-baseline justify-between gap-3 font-semibold ${kind === "token" ? "px-2.5 pt-1.5 pb-3 text-[13px]/normal" : "p-2 text-sm"}`}>
            <span>{heading}</span>
            {context ? <small className="text-xs/normal font-normal text-muted-foreground">{context}</small> : null}
          </div>
          {searchable ? (
            <label className="select-search mx-0.5 mb-2 flex items-center gap-2 rounded-md border border-border bg-surface p-2.5 text-muted-foreground focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2">
              <Search className="shrink-0" size={16} aria-hidden="true" />
              <input
                ref={searchInputRef}
                className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                type="search"
                aria-label="Search tokens by name or symbol"
                aria-controls={menuId}
                placeholder="Search name or symbol"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}
          <div id={menuId} role="listbox" aria-label={menuLabel} className="grid gap-1">
            {filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-label={option.label}
                aria-selected={option.value === value}
                tabIndex={-1}
                className={`group/option flex w-full items-center rounded-md p-2.5 text-left ${kind === "token" ? "min-h-15 gap-2.5 text-sm/normal" : "min-h-12 gap-2 text-sm"}
                  hover:bg-surface-muted aria-selected:bg-accent-soft focus-visible:-outline-offset-2`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                {option.content}
                {option.value === value ? <Check className="select-option-check ml-auto flex-none text-accent-foreground" size={16} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          {filteredOptions.length === 0 ? (
            <p className="select-empty px-2.5 py-3 text-sm/normal text-muted-foreground" role="status">
              No tokens found. Try another name or symbol.
            </p>
          ) : null}
        </PopoverContent>
      </div>
    </Popover>
  );
}
