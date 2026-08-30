import {
  type GameConfig,
  GameConfigSchema,
  mergeRegistryDeclarations,
  resolveEffectiveProfile,
  resolveRunProfile,
  setDefaultProfile,
  updateEnvironment,
  updateProfile,
  updateRegistry,
} from "../src/config.ts";

const declaration = {
  action: "set" as const,
  key: "HKCU\\Software\\Wine\\Explorer",
  name: "Desktop",
  type: "string" as const,
  value: "Common",
};
const config: GameConfig = {
  common: {
    env: { WINEPREFIX: "/tmp/prefix", SHARED: "common", REMOVED: "common" },
    registry: [declaration],
  },
  profiles: {
    launcher: {
      command: "run %u",
      env: { SHARED: "profile", REMOVED: "" },
      registry: [],
    },
  },
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

Deno.test("resolves inherited environment and registry declarations", () => {
  const effective = resolveEffectiveProfile(config, "launcher");
  assert(
    effective.env.SHARED === "profile",
    "profile env did not override common",
  );
  assert(!Object.hasOwn(effective.env, "REMOVED"), "empty env was not unset");
  assert(effective.registry.length === 1, "common registry was not inherited");

  const overridden = mergeRegistryDeclarations(config.common.registry, [{
    ...declaration,
    value: "Profile",
  }]);
  assert(overridden.length === 1, "registry identity was duplicated");
  assert(
    overridden[0].action === "set" && overridden[0].value === "Profile",
    "profile registry did not override common",
  );
});

Deno.test("updates environment with unset and inherit semantics", () => {
  const unset = updateEnvironment(config, "launcher", "SHARED", "unset");
  assert(unset.profiles.launcher.env.SHARED === "", "unset tombstone missing");
  const inherited = updateEnvironment(unset, "launcher", "SHARED", "inherit");
  assert(
    !Object.hasOwn(inherited.profiles.launcher.env, "SHARED"),
    "inherit retained the override",
  );
  const commonUnset = updateEnvironment(config, "common", "SHARED", "unset");
  assert(
    !Object.hasOwn(commonUnset.common.env, "SHARED"),
    "common unset retained the key",
  );
  assertThrows(
    () => updateEnvironment(config, "common", "SHARED", "inherit"),
    /cannot inherit/,
  );
});

Deno.test("updates and removes profile registry overrides", () => {
  const overridden = updateRegistry(config, "launcher", {
    ...declaration,
    value: "Profile",
  });
  assert(
    resolveEffectiveProfile(overridden, "launcher").registry[0].action ===
      "set",
    "registry override was not effective",
  );
  const removed = updateRegistry(
    overridden,
    "launcher",
    undefined,
    declaration,
  );
  assert(
    JSON.stringify(resolveEffectiveProfile(removed, "launcher").registry[0]) ===
      JSON.stringify(declaration),
    "removing override did not restore common declaration",
  );
  assertThrows(
    () => updateRegistry(config, "common", undefined, declaration),
    /cannot inherit/,
  );
});

Deno.test("partially updates profiles and reserves common", () => {
  const added = updateProfile(config, { name: "game", command: "play %t" });
  const withCwd = updateProfile(added, { name: "game", cwd: "/tmp/game" });
  assert(withCwd.profiles.game.cwd === "/tmp/game", "cwd was not updated");
  const withoutCwd = updateProfile(withCwd, {
    name: "game",
    unsetCwd: true,
  });
  assert(withoutCwd.profiles.game.cwd === undefined, "cwd was not removed");
  assertThrows(
    () => updateProfile(config, { name: "new", cwd: "/tmp" }),
    /--command is required/,
  );
  assertThrows(
    () => updateProfile(config, { name: "new" }),
    /Provide --command/,
  );
  assertThrows(
    () => updateProfile(config, { name: "common", command: "run" }),
    /not a launch profile/,
  );
  assertThrows(
    () => updateProfile(config, { name: "__proto__", command: "run" }),
    /reserved/,
  );
  assertThrows(
    () => setDefaultProfile(config, "common"),
    /cannot be the default/,
  );
  const prototypeName = updateProfile(config, {
    name: "toString",
    command: "run",
  });
  assert(
    Object.hasOwn(prototypeName.profiles, "toString"),
    "prototype-named profile was not created",
  );
  const deleted = updateProfile(prototypeName, {
    name: "toString",
    delete: true,
  });
  assert(
    !Object.hasOwn(deleted.profiles, "toString"),
    "prototype-named profile was not deleted",
  );
  assertThrows(
    () => updateProfile(config, { name: "toString", delete: true }),
    /does not exist/,
  );
});

Deno.test("validates profile references and resolves selection", async () => {
  assert(
    !GameConfigSchema.safeParse({ ...config, runProfile: "missing" }).success,
    "missing default profile was accepted",
  );
  assert(
    await resolveRunProfile(config, undefined) === "launcher",
    "default profile was ignored",
  );
  const selectable = setDefaultProfile(
    updateProfile(config, { name: "game", command: "play" }),
    null,
  );
  assert(
    await resolveRunProfile(
      selectable,
      undefined,
      () => Promise.resolve("game"),
    ) === "game",
    "selected profile was ignored",
  );
});
