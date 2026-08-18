import {
  GameConfig,
  GameConfigSchema,
  normalizeConfig,
  resolveRunProfile,
  updateProfile,
  updateRegistry,
} from "../src/config.ts";
import { defaultGames } from "../src/games.ts";

const game = defaultGames[0];
const config: GameConfig = {
  env: { WINEPREFIX: "/tmp/prefix" },
  profiles: { launcher: { command: "run %u" } },
  registry: [],
  runProfile: "launcher",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(action: () => unknown, pattern: RegExp): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error, "non-Error value was thrown");
    assert(pattern.test(error.message), `unexpected error: ${error.message}`);
    return;
  }
  throw new Error("expected an error");
}

Deno.test("normalizes legacy config and preserves an explicit null", () => {
  const legacy = normalizeConfig(
    { env: config.env, profiles: config.profiles },
    game,
  );
  assert(legacy.runProfile === game.runProfile, "default was not restored");

  const withoutDefault = normalizeConfig({ ...config, runProfile: null }, game);
  assert(withoutDefault.runProfile === null, "explicit null was not preserved");
  assert(legacy.registry.length === 0, "legacy registry was not normalized");
});

Deno.test("registry declarations reject invalid keys and replace case-insensitively", () => {
  const withValue = updateRegistry(config, {
    action: "set",
    key: "HKCU\\Software\\Wine\\Explorer",
    name: "Desktop",
    type: "string",
    value: "Default",
  });
  const replaced = updateRegistry(withValue, {
    action: "delete",
    key: "hkcu\\software\\wine\\explorer",
    name: "desktop",
  });
  assert(replaced.registry.length === 1, "registry value was not replaced");
  assert(
    replaced.registry[0].action === "delete",
    "delete declaration was lost",
  );
  assert(
    !GameConfigSchema.safeParse({
      ...config,
      registry: [{
        action: "set",
        key: "Software\\Wine\\Explorer",
        name: "Desktop",
        type: "string",
        value: "Default",
      }],
    }).success,
    "relative registry key was accepted",
  );
  assert(
    !GameConfigSchema.safeParse({
      ...config,
      registry: [{
        action: "set",
        key: "HKCU\\Software\\Wine\\Explorer\nBroken",
        name: "Desktop",
        type: "string",
        value: "Default",
      }],
    }).success,
    "registry key with newline was accepted",
  );
  assert(
    !GameConfigSchema.safeParse({
      ...config,
      registry: [{
        action: "set",
        key: "HKCU\\Software\\Wine\\Explorer",
        name: "Flags",
        type: "dword",
        value: 0x1_0000_0000,
      }],
    }).success,
    "out-of-range DWORD was accepted",
  );
  assert(
    !GameConfigSchema.safeParse({
      ...config,
      registry: [{
        action: "set",
        key: "HKCU\\Software\\Wine\\Explorer",
        name: "Desktop\nBroken",
        type: "string",
        value: "Default",
      }],
    }).success,
    "registry value name with newline was accepted",
  );
  assert(
    !GameConfigSchema.safeParse({
      ...config,
      registry: [{
        action: "set",
        key: "HKCU\\Software\\Wine\\Explorer",
        name: "Desktop",
        type: "string",
        value: "Default\0Broken",
      }],
    }).success,
    "registry string value with NUL was accepted",
  );
});

Deno.test("rejects invalid config fields and profile references", () => {
  assert(
    !GameConfigSchema.safeParse({ ...config, extra: true }).success,
    "unknown config field was accepted",
  );
  const invalid = GameConfigSchema.safeParse({
    ...config,
    runProfile: "missing",
  });
  assert(!invalid.success, "missing run profile was accepted");
  assert(
    invalid.error.issues[0]?.path.join(".") === "runProfile",
    "error did not identify runProfile",
  );
  assert(
    !GameConfigSchema.safeParse({
      env: config.env,
      profiles: {},
      runProfile: "toString",
    }).success,
    "prototype property was accepted as a profile",
  );
});

Deno.test("updates profiles without mutating the source config", () => {
  const added = updateProfile(config, {
    name: "game",
    command: "play %t",
    setDefault: true,
  });
  assert(added.runProfile === "game", "new default was not selected");
  assert(!("game" in config.profiles), "source config was mutated");

  const deleted = updateProfile(added, { name: "game", delete: true });
  assert(deleted.runProfile === null, "deleting the default did not clear it");
  assert(!("game" in deleted.profiles), "profile was not deleted");
});

Deno.test("validates profile operations", () => {
  assertThrows(
    () => updateProfile(config, { name: "missing", setDefault: true }),
    /does not exist/,
  );
  assertThrows(
    () => updateProfile(config, { name: "constructor", setDefault: true }),
    /does not exist/,
  );
  assertThrows(
    () => updateProfile(config, { name: "__proto__", command: "run" }),
    /reserved/,
  );
  assertThrows(
    () => updateProfile(config, { cwd: "/tmp" }),
    /profile name is required/,
  );
  assertThrows(
    () => updateProfile(config, { name: "launcher", cwd: "/tmp" }),
    /requires --command/,
  );
});

Deno.test("resolves launch profiles deterministically", async () => {
  assert(
    await resolveRunProfile(config, "launcher") === "launcher",
    "explicit profile was ignored",
  );
  assert(
    await resolveRunProfile(config, undefined) === "launcher",
    "default profile was ignored",
  );

  const selectable: GameConfig = {
    ...config,
    profiles: {
      launcher: { command: "run %u" },
      game: { command: "run %t" },
    },
    runProfile: null,
  };
  assert(
    await resolveRunProfile(
      selectable,
      undefined,
      () => Promise.resolve("game"),
    ) === "game",
    "interactive profile was ignored",
  );

  let rejected = false;
  try {
    await resolveRunProfile(selectable, undefined);
  } catch (error) {
    rejected = error instanceof Error && /--profile/.test(error.message);
  }
  assert(rejected, "ambiguous non-interactive selection was accepted");
});
