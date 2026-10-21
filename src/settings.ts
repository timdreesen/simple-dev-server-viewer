/** Preferences from the settings menu that are stored in localStorage. */

export const SCAN_INTERVALS_MS = [1000, 2000, 5000, 10000, 30000] as const;
export const DEFAULT_SCAN_INTERVAL_MS = 2000;
/** While the window is hidden in the tray, scan at most this often. */
export const HIDDEN_SCAN_INTERVAL_MS = 10000;

export type CloseAction = "tray" | "quit";

export function parseScanInterval(value: string | null): number {
  return SCAN_INTERVALS_MS.find((interval) => String(interval) === value) ?? DEFAULT_SCAN_INTERVAL_MS;
}

export function parseCloseAction(value: string | null): CloseAction {
  return value === "quit" ? "quit" : "tray";
}
