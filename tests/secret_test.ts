import { KEYRING_SERVICE, LEGACY_KEYRING_SERVICE } from "../src/app.ts";
import { PasswordStore, readPasswordWithMigration } from "../src/password.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function memoryStore(entries: Record<string, string>): PasswordStore {
  return {
    get: (service, name) => entries[`${service}:${name}`],
    set: (service, name, password) => {
      entries[`${service}:${name}`] = password;
    },
  };
}

Deno.test("keyring migration copies a missing current entry", () => {
  const entries: Record<string, string> = {
    [`${LEGACY_KEYRING_SERVICE}:custom`]: "legacy-password",
  };
  const password = readPasswordWithMigration(
    memoryStore(entries),
    KEYRING_SERVICE,
    "custom",
  );
  assert(password === "legacy-password", "legacy entry was not returned");
  assert(
    entries[`${KEYRING_SERVICE}:custom`] === "legacy-password",
    "legacy entry was not copied",
  );
});

Deno.test("keyring migration preserves current and custom services", () => {
  const entries: Record<string, string> = {
    [`${KEYRING_SERVICE}:current`]: "current-password",
    [`${LEGACY_KEYRING_SERVICE}:current`]: "legacy-password",
    "custom.service:custom": "custom-password",
    [`${LEGACY_KEYRING_SERVICE}:custom`]: "legacy-custom-password",
  };
  const store = memoryStore(entries);

  assert(
    readPasswordWithMigration(store, KEYRING_SERVICE, "current") ===
      "current-password",
    "current entry was not preferred",
  );
  assert(
    readPasswordWithMigration(store, "custom.service", "custom") ===
      "custom-password",
    "custom service was changed",
  );
  assert(
    readPasswordWithMigration(store, KEYRING_SERVICE, "missing") === undefined,
    "missing entry unexpectedly migrated",
  );
});

Deno.test("keyring migration treats empty entries as present", () => {
  const currentEntries: Record<string, string> = {
    [`${KEYRING_SERVICE}:empty`]: "",
    [`${LEGACY_KEYRING_SERVICE}:empty`]: "legacy-password",
  };
  assert(
    readPasswordWithMigration(
      memoryStore(currentEntries),
      KEYRING_SERVICE,
      "empty",
    ) === "",
    "empty current entry was overwritten",
  );

  const legacyEntries: Record<string, string> = {
    [`${LEGACY_KEYRING_SERVICE}:empty`]: "",
  };
  assert(
    readPasswordWithMigration(
      memoryStore(legacyEntries),
      KEYRING_SERVICE,
      "empty",
    ) === "",
    "empty legacy entry was not returned",
  );
  assert(
    legacyEntries[`${KEYRING_SERVICE}:empty`] === "",
    "empty legacy entry was not copied",
  );
});
