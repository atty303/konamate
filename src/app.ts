import * as path from "@std/path";
import xdg from "@404wolf/xdg-portable";

export const APP_NAME = "konamate";
export const LEGACY_APP_NAME = "konaste";
export const LEGACY_BROWSER_NAME = "konaste-buddy";

export const KEYRING_SERVICE = "io.github.atty303.konamate";
export const LEGACY_KEYRING_SERVICE = "io.github.atty303.konaste-buddy";
export const DEFAULT_PASSKEY_NAME = "passkey-default";

export function configDir(): string {
  return path.join(xdg.config(), APP_NAME);
}

export function legacyConfigDir(): string {
  return path.join(xdg.config(), LEGACY_APP_NAME);
}

export function stateDir(): string {
  return path.join(xdg.state(), APP_NAME);
}

export function legacyStateDir(): string {
  return path.join(xdg.state(), LEGACY_BROWSER_NAME);
}
