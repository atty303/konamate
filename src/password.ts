import { KEYRING_SERVICE, LEGACY_KEYRING_SERVICE } from "./app.ts";

export type PasswordStore = {
  get(service: string, name: string): string | undefined;
  set(service: string, name: string, password: string): void;
};

export function readPasswordWithMigration(
  store: PasswordStore,
  service: string,
  name: string,
): string | undefined {
  const password = store.get(service, name);
  if (password !== undefined || service !== KEYRING_SERVICE) return password;

  const legacyPassword = store.get(LEGACY_KEYRING_SERVICE, name);
  if (legacyPassword === undefined) return undefined;
  store.set(KEYRING_SERVICE, name, legacyPassword);
  return legacyPassword;
}
