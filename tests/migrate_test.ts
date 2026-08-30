import * as path from "@std/path";
import { readConfigFile, writeConfigFile } from "../src/config_file.ts";
import {
  migrateDirectory,
  migrateUnifiedConfig,
  migrationDisplayName,
  preflightUnifiedDirectoryMigration,
} from "../src/migrate.ts";
import { emptyKonamateConfig } from "../src/models.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertRejects(
  action: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error, "non-Error value was thrown");
    assert(pattern.test(error.message), `unexpected error: ${error.message}`);
    return;
  }
  throw new Error("expected an error");
}

Deno.test("migration copies missing data and preserves conflicts", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = path.join(root, "legacy");
    const destination = path.join(root, "current");
    await Deno.mkdir(path.join(source, "nested"), { recursive: true });
    await Deno.mkdir(destination, { recursive: true });
    await Deno.writeTextFile(path.join(source, "new.json"), "legacy-new");
    await Deno.writeTextFile(path.join(source, "conflict.json"), "legacy");
    await Deno.writeTextFile(
      path.join(source, "nested", "state.json"),
      "state",
    );
    await Deno.writeTextFile(
      path.join(destination, "conflict.json"),
      "current",
    );

    const report = await migrateDirectory(source, destination);
    assert(report.copied.length === 2, "missing files were not copied");
    assert(report.conflicts.length === 1, "conflict was not reported");
    assert(
      await Deno.readTextFile(path.join(destination, "conflict.json")) ===
        "current",
      "existing destination was overwritten",
    );
    assert(
      await Deno.readTextFile(
        path.join(destination, "nested", "state.json"),
      ) ===
        "state",
      "nested file was not copied",
    );

    const repeated = await migrateDirectory(source, destination);
    assert(repeated.copied.length === 0, "migration was not idempotent");
    assert(repeated.conflicts.length === 3, "existing files were not reported");
    assert(
      await Deno.readTextFile(path.join(source, "new.json")) === "legacy-new",
      "legacy source was modified",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration ignores a missing source", async () => {
  const root = await Deno.makeTempDir();
  try {
    const report = await migrateDirectory(
      path.join(root, "missing"),
      path.join(root, "current"),
    );
    assert(report.copied.length === 0, "missing source copied data");
    assert(report.conflicts.length === 0, "missing source reported conflicts");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration rejects symbolic links before copying", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = path.join(root, "legacy");
    const destination = path.join(root, "current");
    await Deno.mkdir(source);
    await Deno.writeTextFile(path.join(source, "regular.json"), "data");
    await Deno.symlink("regular.json", path.join(source, "linked.json"));

    await assertRejects(
      () => migrateDirectory(source, destination),
      /Cannot migrate symbolic link.*linked\.json/,
    );
    try {
      await Deno.stat(destination);
      throw new Error("migration copied data before rejecting the link");
    } catch (error) {
      assert(
        error instanceof Deno.errors.NotFound,
        error instanceof Error ? error.message : String(error),
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration combines settings games and profiles into config.toml", async () => {
  const root = await Deno.makeTempDir();
  try {
    const settings = JSON.stringify({ browser: "/usr/bin/chromium" });
    const games = JSON.stringify([{
      id: "custom",
      name: "Custom Game",
      urlScheme: "custom.game",
      loginUrl: "https://example.com/login",
      registryKey: "Software\\Custom",
      profiles: { launcher: { command: "run %u" } },
      runProfile: "launcher",
    }]);
    const profile = JSON.stringify({
      env: { WINEPREFIX: "/tmp/custom", SHARED: "value" },
      profiles: { launcher: { command: "run %u" } },
      registry: [],
      runProfile: "launcher",
    });
    await Deno.writeTextFile(path.join(root, "config.json"), settings);
    await Deno.writeTextFile(path.join(root, "games.json"), games);
    await Deno.writeTextFile(path.join(root, "custom.json"), profile);

    const report = await migrateUnifiedConfig(root);
    assert(report.migrated.length === 3, "not all JSON files were migrated");
    const config = await readConfigFile(path.join(root, "config.toml"));
    assert(
      config.settings.browser === "/usr/bin/chromium",
      "settings were not migrated",
    );
    assert(config.games.custom.name === "Custom Game", "game was not migrated");
    assert(
      config.profiles.custom.common.env.SHARED === "value",
      "common environment was not migrated",
    );
    for (
      const [name, content] of [
        ["config", settings],
        ["games", games],
        ["custom", profile],
      ]
    ) {
      const backup = path.join(
        root,
        `${name}.pre-unified-toml-migration.json`,
      );
      assert(
        await Deno.readTextFile(backup) === content,
        `${name} backup differs`,
      );
      let removed = false;
      try {
        await Deno.stat(path.join(root, `${name}.json`));
      } catch (error) {
        removed = error instanceof Deno.errors.NotFound;
      }
      assert(removed, `${name}.json was not removed`);
    }

    const repeated = await migrateUnifiedConfig(root);
    assert(repeated.migrated.length === 0, "completed migration repeated work");
    assert(repeated.skipped.length === 1, "config.toml was not skipped");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration rejects a conflicting backup before publishing TOML", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      path.join(root, "config.json"),
      JSON.stringify({ browser: "/usr/bin/chromium" }),
    );
    await Deno.writeTextFile(
      path.join(root, "config.pre-unified-toml-migration.json"),
      JSON.stringify({ browser: "/different/browser" }),
    );
    await assertRejects(
      () => migrateUnifiedConfig(root),
      /backup conflicts/,
    );
    let missing = false;
    try {
      await Deno.stat(path.join(root, "config.toml"));
    } catch (error) {
      missing = error instanceof Deno.errors.NotFound;
    }
    assert(missing, "conflicting migration published config.toml");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration resumes after backups and during JSON cleanup", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixtures = {
      "config.json": JSON.stringify({ browser: "/usr/bin/chromium" }),
      "games.json": JSON.stringify([{
        id: "custom",
        name: "Custom Game",
        urlScheme: "custom.game",
        loginUrl: "https://example.com/login",
        registryKey: "Software\\Custom",
        profiles: { launcher: { command: "run %u" } },
        runProfile: "launcher",
      }]),
      "custom.json": JSON.stringify({
        env: { WINEPREFIX: "/tmp/custom" },
        profiles: { launcher: { command: "run %u" } },
        runProfile: "launcher",
      }),
    };
    for (const [name, body] of Object.entries(fixtures)) {
      const source = path.join(root, name);
      await Deno.writeTextFile(source, body);
      await Deno.writeTextFile(
        source.replace(/\.json$/, ".pre-unified-toml-migration.json"),
        body,
      );
      await Deno.remove(source);
    }

    const afterBackup = await migrateUnifiedConfig(root);
    assert(
      afterBackup.resumed.length === 3,
      "backup-only state was not resumed",
    );
    await readConfigFile(path.join(root, "config.toml"));

    await Deno.writeTextFile(
      path.join(root, "custom.json"),
      fixtures["custom.json"],
    );
    const duringCleanup = await migrateUnifiedConfig(root);
    assert(
      duringCleanup.resumed.includes(path.join(root, "custom.json")),
      "cleanup state was not resumed",
    );
    await assertRejects(
      () => Deno.readTextFile(path.join(root, "custom.json")),
      /No such file|not found/i,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration rejects duplicate custom game IDs before writing", async () => {
  const root = await Deno.makeTempDir();
  try {
    const game = {
      id: "duplicate",
      name: "Duplicate",
      urlScheme: "duplicate.game",
      loginUrl: "https://example.com/login",
      registryKey: "Software\\Duplicate",
      profiles: { launcher: { command: "run %u" } },
      runProfile: "launcher",
    };
    const gamesPath = path.join(root, "games.json");
    await Deno.writeTextFile(gamesPath, JSON.stringify([game, game]));
    await assertRejects(() => migrateUnifiedConfig(root), /Duplicate game ID/);
    assert(await Deno.readTextFile(gamesPath) !== "", "source was modified");
    await assertRejects(
      () => Deno.readTextFile(path.join(root, "config.toml")),
      /No such file|not found/i,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration preserves a different existing config.toml", async () => {
  const root = await Deno.makeTempDir();
  try {
    const json = path.join(root, "config.json");
    const target = path.join(root, "config.toml");
    await Deno.writeTextFile(json, JSON.stringify({ browser: "/new/browser" }));
    await Deno.writeTextFile(
      target,
      '[settings]\nbrowser = "/existing/browser"\n',
    );
    await assertRejects(
      () => migrateUnifiedConfig(root),
      /differs from the JSON migration result/,
    );
    assert(
      (await readConfigFile(target)).settings.browser === "/existing/browser",
      "existing TOML was overwritten",
    );
    assert(await Deno.readTextFile(json) !== "", "JSON source was modified");
    await assertRejects(
      () =>
        Deno.readTextFile(
          path.join(root, "config.pre-unified-toml-migration.json"),
        ),
      /No such file|not found/i,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration compares backup-only state with existing TOML", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      path.join(root, "config.pre-unified-toml-migration.json"),
      JSON.stringify({ browser: "/from-backup" }),
    );
    const target = path.join(root, "config.toml");
    await Deno.writeTextFile(target, '[settings]\nbrowser = "/different"\n');
    await assertRejects(
      () => migrateUnifiedConfig(root),
      /differs from the JSON migration result/,
    );
    assert(
      (await readConfigFile(target)).settings.browser === "/different",
      "different TOML was overwritten",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration resumes a profile known only by existing TOML", async () => {
  const root = await Deno.makeTempDir();
  try {
    const config = emptyKonamateConfig();
    config.profiles.custom = {
      common: { env: { WINEPREFIX: "/tmp/custom" }, registry: [] },
      profiles: {
        launcher: { command: "run %u", env: {}, registry: [] },
      },
      runProfile: "launcher",
    };
    await writeConfigFile(config, path.join(root, "config.toml"));
    const source = path.join(root, "custom.json");
    await Deno.writeTextFile(
      source,
      JSON.stringify({
        env: { WINEPREFIX: "/tmp/custom" },
        profiles: { launcher: { command: "run %u" } },
        runProfile: "launcher",
      }),
    );

    const report = await migrateUnifiedConfig(root);
    assert(
      report.migrated.includes(source),
      "TOML-only game ID was not resumed",
    );
    await assertRejects(
      () => Deno.readTextFile(source),
      /No such file|not found/i,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration detects a conflicting profile known only by TOML", async () => {
  const root = await Deno.makeTempDir();
  try {
    const config = emptyKonamateConfig();
    config.profiles.custom = {
      common: { env: { WINEPREFIX: "/from-toml" }, registry: [] },
      profiles: {
        launcher: { command: "run %u", env: {}, registry: [] },
      },
      runProfile: "launcher",
    };
    const target = path.join(root, "config.toml");
    await writeConfigFile(config, target);
    const source = path.join(root, "custom.json");
    await Deno.writeTextFile(
      source,
      JSON.stringify({
        env: { WINEPREFIX: "/from-json" },
        profiles: { launcher: { command: "run %u" } },
        runProfile: "launcher",
      }),
    );

    await assertRejects(
      () => migrateUnifiedConfig(root),
      /differs from the JSON migration result/,
    );
    assert(await Deno.readTextFile(source) !== "", "JSON source was modified");
    assert(
      (await readConfigFile(target)).profiles.custom.common.env.WINEPREFIX ===
        "/from-toml",
      "existing TOML was modified",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration rejects game IDs that escape the config directory", async () => {
  const root = await Deno.makeTempDir();
  try {
    const directory = path.join(root, "config");
    await Deno.mkdir(directory);
    await Deno.writeTextFile(
      path.join(directory, "games.json"),
      JSON.stringify([{
        id: "../victim",
        name: "Victim",
        urlScheme: "victim.game",
        loginUrl: "https://example.com/login",
        registryKey: "Software\\Victim",
        profiles: { launcher: { command: "run" } },
        runProfile: "launcher",
      }]),
    );
    const victim = path.join(root, "victim.json");
    const victimBody = JSON.stringify({
      env: {},
      profiles: { launcher: { command: "run" } },
      runProfile: "launcher",
    });
    await Deno.writeTextFile(victim, victimBody);

    await assertRejects(
      () => migrateUnifiedConfig(directory),
      /cannot be used as a configuration filename/,
    );
    assert(
      await Deno.readTextFile(victim) === victimBody,
      "external JSON was modified",
    );
    await assertRejects(
      () =>
        Deno.readTextFile(
          path.join(root, "victim.pre-unified-toml-migration.json"),
        ),
      /No such file|not found/i,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("unified migration rejects symbolic-link inputs before writing", async () => {
  const root = await Deno.makeTempDir();
  try {
    const directory = path.join(root, "config");
    await Deno.mkdir(directory);
    const outside = path.join(root, "outside.json");
    const body = JSON.stringify({ browser: "/usr/bin/chromium" });
    await Deno.writeTextFile(outside, body);
    const linked = path.join(directory, "config.json");
    await Deno.symlink(outside, linked);

    await assertRejects(
      () => migrateUnifiedConfig(directory),
      /must be a regular file/,
    );
    assert(
      await Deno.readTextFile(outside) === body,
      "symlink target was modified",
    );
    assert((await Deno.lstat(linked)).isSymlink, "source symlink was removed");
    await assertRejects(
      () => Deno.readTextFile(path.join(directory, "config.toml")),
      /No such file|not found/i,
    );
    await assertRejects(
      () =>
        Deno.readTextFile(
          path.join(directory, "config.pre-unified-toml-migration.json"),
        ),
      /No such file|not found/i,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration makes reused TOML and backups owner-only", async () => {
  const root = await Deno.makeTempDir();
  try {
    const backup = path.join(root, "config.pre-unified-toml-migration.json");
    const target = path.join(root, "config.toml");
    await Deno.writeTextFile(backup, JSON.stringify({ browser: "/browser" }));
    await Deno.writeTextFile(target, '[settings]\nbrowser = "/browser"\n');
    await Deno.chmod(backup, 0o644);
    await Deno.chmod(target, 0o644);

    const report = await migrateUnifiedConfig(root);
    assert(
      report.skipped.includes(target),
      "completed migration was not reused",
    );
    assert(
      ((await Deno.stat(backup)).mode! & 0o777) === 0o600,
      "reused backup was not made private",
    );
    assert(
      ((await Deno.stat(target)).mode! & 0o777) === 0o600,
      "reused TOML was not made private",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration output names omit configuration directories", () => {
  assert(
    migrationDisplayName("/private/config/custom.json") === "custom.json",
    "migration output retained its directory",
  );
});

Deno.test("standalone TOML no-op restores owner-only permissions", async () => {
  const root = await Deno.makeTempDir();
  try {
    const target = path.join(root, "config.toml");
    await Deno.writeTextFile(target, "[settings]\n");
    await Deno.chmod(target, 0o644);
    await migrateUnifiedConfig(root);
    assert(
      ((await Deno.stat(target)).mode! & 0o777) === 0o600,
      "standalone TOML remained publicly readable",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration reuses semantically equal JSON backups", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = path.join(root, "config.json");
    const backup = path.join(root, "config.pre-unified-toml-migration.json");
    await Deno.writeTextFile(source, '{"browser":"/browser"}');
    await Deno.writeTextFile(backup, '{\n  "browser": "/browser"\n}\n');
    const report = await migrateUnifiedConfig(root);
    assert(report.resumed.includes(source), "equivalent backup was not reused");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("legacy relocation is preflighted before copying invalid JSON", async () => {
  const root = await Deno.makeTempDir();
  try {
    const legacy = path.join(root, "legacy");
    const current = path.join(root, "current");
    await Deno.mkdir(legacy);
    const game = {
      id: "duplicate",
      name: "Duplicate",
      urlScheme: "duplicate.game",
      loginUrl: "https://example.com/login",
      registryKey: "Software\\Duplicate",
      profiles: { launcher: { command: "run" } },
      runProfile: "launcher",
    };
    await Deno.writeTextFile(
      path.join(legacy, "games.json"),
      JSON.stringify([game, game]),
    );
    await assertRejects(
      () => preflightUnifiedDirectoryMigration(legacy, current),
      /Duplicate game ID/,
    );
    await assertRejects(
      () => Deno.readTextFile(path.join(current, "games.json")),
      /No such file|not found/i,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("legacy preflight ignores JSON outside the known game set", async () => {
  const root = await Deno.makeTempDir();
  try {
    const legacy = path.join(root, "legacy");
    const current = path.join(root, "current");
    await Deno.mkdir(legacy);
    const outside = path.join(root, "outside.json");
    await Deno.writeTextFile(outside, "{}");
    await Deno.symlink(outside, path.join(legacy, "unrelated.json"));
    await preflightUnifiedDirectoryMigration(legacy, current);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
