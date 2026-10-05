/**
 * The store decides WHEN links should be rewritten after a rename or move, but
 * asking the user ("Ask" mode) and telling them what happened are UI jobs. App
 * registers them here at mount, so store code stays free of React.
 */

export interface LinkUpdateInfo {
  /** The note being renamed/moved, for the question. */
  name: string;
  notes: number;
  links: number;
}

export interface LinkUpdateUi {
  confirm: (info: LinkUpdateInfo) => Promise<boolean>;
  /** After a rewrite: `failed` > 0 means some notes could not be written. */
  notify: (result: { notes: number; links: number; failed: number }) => void;
}

let ui: LinkUpdateUi | null = null;

export function registerLinkUpdateUi(next: LinkUpdateUi | null): void {
  ui = next;
}

export function getLinkUpdateUi(): LinkUpdateUi | null {
  return ui;
}
