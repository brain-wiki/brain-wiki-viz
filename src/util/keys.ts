// Shortcut labels as each platform writes them: ⌥ and ⌘ on a Mac, Alt and Ctrl elsewhere.

type NavigatorWithData = Navigator & { userAgentData?: { platform?: string } };

export function isMac(nav: NavigatorWithData | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  const platform = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export interface Keys {
  /** The Alt key: Option (⌥) on a Mac. */
  alt: string;
  /** The command key for shortcuts like K: ⌘ on a Mac, Ctrl elsewhere. */
  mod: string;
  /** What the browser's own back and forward use: ⌘ on a Mac, Alt elsewhere. */
  history: string;
  /** How a modifier joins its key: "⌥↑" on a Mac, "Alt+↑" elsewhere. */
  join(modifier: string, key: string): string;
}

export function keys(mac = isMac()): Keys {
  return mac
    ? { alt: "⌥", mod: "⌘", history: "⌘", join: (m, k) => `${m}${k}` }
    : { alt: "Alt", mod: "Ctrl", history: "Alt", join: (m, k) => `${m}+${k}` };
}
