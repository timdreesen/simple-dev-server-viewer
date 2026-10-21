import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "./i18n";
import type { TypeOption } from "./services";

const MAX_CHIPS = 2;

/** A searchable multi-select for service types, in the spirit of Select2. */
export function TypeFilter({
  options,
  selected,
  onChange,
  renderIcon,
}: {
  options: TypeOption[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  renderIcon: (option: TypeOption) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const term = search.trim().toLowerCase();
  const filtered = options.filter((option) => option.label.toLowerCase().includes(term));
  const chosen = options.filter((option) => selected.has(option.type));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) return;
    setSearch("");
    setActive(0);
  }, [open]);

  const toggle = (type: string) => {
    const next = new Set(selected);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange(next);
  };

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => Math.min(Math.max(index + step, 0), filtered.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[active]) toggle(filtered[active].type);
    } else if (event.key === "Escape") {
      // Keep the app's Escape shortcut from clearing the name filter.
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="type-filter" ref={rootRef}>
      <div className={`type-control ${open ? "open" : ""}`}>
        {chosen.slice(0, MAX_CHIPS).map((option) => (
          <span key={option.type} className="type-chip">
            {option.label}
            <button
              type="button"
              onClick={() => toggle(option.type)}
              aria-label={t("removeType", { type: option.label })}
              title={t("removeType", { type: option.label })}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {chosen.length > MAX_CHIPS && <span className="type-chip more">+{chosen.length - MAX_CHIPS}</span>}
        <button
          ref={toggleRef}
          type="button"
          className="type-toggle"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t("typeFilterLabel")}
          onClick={() => setOpen((current) => !current)}
        >
          {chosen.length === 0 && <span className="type-placeholder">{t("typeFilter")}</span>}
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>

      {open && (
        <div className="type-panel">
          <input
            className="type-search"
            autoFocus
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("typeFilterSearch")}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
            spellCheck={false}
          />
          <ul
            id={listId}
            className="type-options"
            role="listbox"
            aria-multiselectable
            aria-label={t("typeFilterLabel")}
          >
            {filtered.map((option, index) => (
              <li
                key={option.type}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected.has(option.type)}
                className={`type-option ${index === active ? "active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(option.type)}
              >
                <span className="type-check">{selected.has(option.type) && <Check size={13} />}</span>
                <span className="type-icon">{renderIcon(option)}</span>
                <span className="type-label">{option.label}</span>
                <span className="type-count">{option.count}</span>
              </li>
            ))}
            {filtered.length === 0 && <li className="type-empty">{t("noTypes")}</li>}
          </ul>
          {selected.size > 0 && (
            <button type="button" className="type-clear" onClick={() => onChange(new Set())}>
              {t("clearTypes")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
