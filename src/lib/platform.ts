// Renderer-side OS detection for keyboard-shortcut labels. The sandboxed
// renderer has no `process.platform`, so detect from the UA (reliable under
// Electron's Chromium). macOS is the primary target and shows the Apple glyphs;
// Windows and Linux show word modifiers (Ctrl/Shift/Alt).
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

export const isMac = /Mac/i.test(ua);

/** Primary modifier label: ⌘ on macOS, "Ctrl" elsewhere. */
export const modKey = isMac ? '⌘' : 'Ctrl';
/** Shift label: ⇧ on macOS, "Shift" elsewhere. */
export const shiftKey = isMac ? '⇧' : 'Shift';

/**
 * Adapt the Apple modifier glyphs baked into a display string to the current
 * platform's convention (⌘→Ctrl, ⌥→Alt). No-op on macOS. Used to platform-fix
 * the shortcut hints embedded in localized strings.
 */
export function platformizeShortcut(s: string): string {
  return isMac ? s : s.replace(/⌘/g, 'Ctrl').replace(/⌥/g, 'Alt');
}
