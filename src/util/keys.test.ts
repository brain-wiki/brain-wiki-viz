import { describe, expect, it } from "vitest";
import { isMac, keys } from "./keys";

describe("shortcut labels", () => {
  it("use the Mac's symbols on a Mac and spelled-out keys elsewhere", () => {
    const mac = keys(true);
    expect(mac.join(mac.alt, "↑")).toBe("⌥↑");
    expect(mac.join(mac.mod, "K")).toBe("⌘K");
    expect(mac.join(mac.history, "←")).toBe("⌘←");
    const pc = keys(false);
    expect(pc.join(pc.alt, "↑")).toBe("Alt+↑");
    expect(pc.join(pc.mod, "K")).toBe("Ctrl+K");
    expect(pc.join(pc.history, "←")).toBe("Alt+←");
  });

  it("detects the platform from the browser", () => {
    const nav = (platform: string, data?: string) =>
      ({ platform, userAgent: "", userAgentData: data ? { platform: data } : undefined }) as unknown as Navigator;
    expect(isMac(nav("MacIntel"))).toBe(true);
    expect(isMac(nav("", "macOS"))).toBe(true);
    expect(isMac(nav("Win32"))).toBe(false);
    expect(isMac(nav("Linux x86_64"))).toBe(false);
    expect(isMac(undefined)).toBe(false);
  });
});
