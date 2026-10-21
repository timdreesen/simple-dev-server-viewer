import { ChevronDown, Settings, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { detectLocale, localeNames, supportedLocales, t, type LanguagePreference } from "./i18n";
import { DEFAULT_SCAN_INTERVAL_MS, SCAN_INTERVALS_MS, type CloseAction } from "./settings";

export interface SettingsValues {
  language: LanguagePreference;
  /** `null` while unknown or when the system doesn't support it. */
  launchAtLogin: boolean | null;
  closeAction: CloseAction;
  scanInterval: number;
  showPreviews: boolean;
  showOthers: boolean;
}

export const formatSeconds = (ms: number) => t("seconds", { count: ms / 1000 });

/** The settings button in the status bar and its popover. */
export function SettingsMenu({
  values,
  othersCount,
  onChange,
}: {
  values: SettingsValues;
  othersCount?: number;
  onChange: (changes: Partial<SettingsValues>) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // Keep the app's Escape shortcut from clearing the name filter.
    event.stopPropagation();
    close();
  };

  const system = localeNames[detectLocale(navigator.languages)];

  return (
    <div className="settings" ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className="settings-toggle"
        aria-label={t("settings")}
        title={t("settings")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Settings size={15} aria-hidden />
      </button>
      {open && (
        <div className="settings-panel" role="dialog" aria-labelledby={titleId} onKeyDown={onKeyDown}>
          <header className="settings-header">
            <h2 id={titleId}>{t("settings")}</h2>
            <button type="button" className="settings-close" aria-label={t("closeSettings")} onClick={close}>
              <X size={14} aria-hidden />
            </button>
          </header>

          <div className="settings-body">
            <SettingsSection title={t("settingsGeneral")}>
              <SettingRow
                label={t("language")}
                detail={values.language === "auto" ? t("languageAutoDetail", { language: system }) : undefined}
              >
                {(id) => (
                  <span className="settings-select">
                    <select
                      id={id}
                      autoFocus
                      value={values.language}
                      onChange={(event) => onChange({ language: event.target.value as LanguagePreference })}
                    >
                      <option value="auto">{t("languageAuto")}</option>
                      {supportedLocales.map((locale) => (
                        <option key={locale} value={locale}>
                          {localeNames[locale]}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} aria-hidden />
                  </span>
                )}
              </SettingRow>
              <SettingRow
                label={t("launchAtLogin")}
                detail={values.launchAtLogin === null ? t("launchAtLoginUnavailable") : t("launchAtLoginDetail")}
              >
                {(id) => (
                  <Switch
                    id={id}
                    checked={values.launchAtLogin ?? false}
                    disabled={values.launchAtLogin === null}
                    onChange={(launchAtLogin) => onChange({ launchAtLogin })}
                  />
                )}
              </SettingRow>
              <SettingRow
                label={t("onClose")}
                detail={values.closeAction === "tray" ? t("closeToTrayDetail") : t("closeQuitDetail")}
                stacked
              >
                {(id) => (
                  <Segmented
                    id={id}
                    value={values.closeAction}
                    options={[
                      { value: "tray", label: t("closeToTray") },
                      { value: "quit", label: t("closeQuit") },
                    ]}
                    onChange={(closeAction) => onChange({ closeAction })}
                  />
                )}
              </SettingRow>
            </SettingsSection>

            <SettingsSection title={t("settingsDisplay")}>
              <SettingRow label={t("previewsSetting")} detail={t("showPreviewsTitle")}>
                {(id) => (
                  <Switch
                    id={id}
                    checked={values.showPreviews}
                    onChange={(showPreviews) => onChange({ showPreviews })}
                  />
                )}
              </SettingRow>
              <SettingRow label={t("showOtherProcesses")} badge={othersCount} detail={t("otherProcessesDetail")}>
                {(id) => (
                  <Switch id={id} checked={values.showOthers} onChange={(showOthers) => onChange({ showOthers })} />
                )}
              </SettingRow>
            </SettingsSection>

            <SettingsSection title={t("settingsUpdates")}>
              <SettingRow
                label={t("scanInterval")}
                detail={t("scanIntervalDetail", { default: formatSeconds(DEFAULT_SCAN_INTERVAL_MS) })}
                stacked
              >
                {(id) => (
                  <Segmented
                    id={id}
                    value={values.scanInterval}
                    options={SCAN_INTERVALS_MS.map((interval) => ({
                      value: interval,
                      label: formatSeconds(interval),
                      note: interval === DEFAULT_SCAN_INTERVAL_MS ? t("defaultOption") : undefined,
                    }))}
                    onChange={(scanInterval) => onChange({ scanInterval })}
                  />
                )}
              </SettingRow>
            </SettingsSection>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  detail,
  badge,
  stacked = false,
  children,
}: {
  label: string;
  detail?: string;
  badge?: number;
  stacked?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={`setting-row ${stacked ? "stacked" : ""}`}>
      <div className="setting-text">
        <label id={`${id}-label`} htmlFor={id}>
          {label}
          {badge !== undefined && <span className="filter-count">{badge}</span>}
        </label>
        {detail && <p>{detail}</p>}
      </div>
      <div className="setting-control">{children(id)}</div>
    </div>
  );
}

function Switch({
  id,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden />
    </button>
  );
}

function Segmented<T extends string | number>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: { value: T; label: string; note?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div id={id} className="segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.note && <small>{option.note}</small>}
        </button>
      ))}
    </div>
  );
}
