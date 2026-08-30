import {
  AppSettingsSchema,
  browserSearchDirectories,
  detectBrowserExecutable,
  readSettings,
  resolveBrowserExecutable,
  writeSettings,
} from "../src/settings.ts";
import { readConfigFile, writeConfigFile } from "../src/config_file.ts";
import { emptyKonamateConfig } from "../src/models.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createExecutable(filePath: string): Promise<void> {
  await Deno.mkdir(filePath.substring(0, filePath.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeTextFile(filePath, "#!/bin/sh\n");
  await Deno.chmod(filePath, 0o755);
}

Deno.test("persists and validates application settings", async () => {
  const directory = await Deno.makeTempDir();
  const file = `${directory}/config.toml`;
  try {
    await writeSettings({ browser: "/usr/bin/chromium" }, file);
    assert(
      (await readSettings(file)).browser === "/usr/bin/chromium",
      "browser setting was not preserved",
    );

    await Deno.writeTextFile(file, '[settings]\nbrowser = ""\nextra = 1\n');
    let rejected = false;
    try {
      await readSettings(file);
    } catch {
      rejected = true;
    }
    assert(rejected, "invalid settings were accepted");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("settings writes preserve games and profiles", async () => {
  const directory = await Deno.makeTempDir();
  const file = `${directory}/config.toml`;
  try {
    const config = emptyKonamateConfig();
    config.games.sample = {
      id: "sample",
      name: "Sample",
      urlScheme: "sample.game",
      loginUrl: "https://example.com/login",
      registryKey: "Software\\Sample",
      common: { env: {}, registry: [] },
      profiles: {
        launcher: { command: "run", env: {}, registry: [] },
      },
      runProfile: "launcher",
    };
    config.profiles.sample = {
      common: { env: {}, registry: [] },
      profiles: {
        launcher: { command: "run", env: {}, registry: [] },
      },
      runProfile: "launcher",
    };
    await writeConfigFile(config, file);
    await writeSettings({ browser: "/usr/bin/chromium" }, file);
    const updated = await readConfigFile(file);
    assert(updated.games.sample !== undefined, "games were discarded");
    assert(updated.profiles.sample !== undefined, "profiles were discarded");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("browser override does not require stored settings", async () => {
  assert(
    await resolveBrowserExecutable("/temporary/browser") ===
      "/temporary/browser",
    "browser override was not preferred",
  );
  assert(
    !AppSettingsSchema.safeParse({ browser: "" }).success,
    "empty browser path was accepted",
  );
});

Deno.test("builds browser search directories from PATH and Flatpak locations", () => {
  const directories = browserSearchDirectories({
    path: "/first::relative:/second:/first",
    home: "/home/tester",
  });
  assert(
    JSON.stringify(directories) === JSON.stringify([
      "/first",
      "/second",
      "/home/tester/.local/share/flatpak/exports/bin",
      "/var/lib/flatpak/exports/bin",
    ]),
    `unexpected search directories: ${JSON.stringify(directories)}`,
  );
});

Deno.test("detects compatible executable by browser priority", async () => {
  const root = await Deno.makeTempDir();
  const first = `${root}/first`;
  const second = `${root}/second`;
  try {
    await createExecutable(`${first}/chromium`);
    await createExecutable(`${second}/google-chrome-stable`);
    await Deno.writeTextFile(`${first}/google-chrome`, "not executable");
    assert(
      await detectBrowserExecutable([first, second]) ===
        `${second}/google-chrome-stable`,
      "browser priority was not preserved",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("detects and persists a browser when settings are missing", async () => {
  const root = await Deno.makeTempDir();
  const bin = `${root}/bin`;
  const file = `${root}/config/config.toml`;
  try {
    await createExecutable(`${bin}/com.brave.Browser`);
    const browser = await resolveBrowserExecutable(undefined, {
      settingsFile: file,
      searchDirectories: [bin],
    });
    assert(browser === `${bin}/com.brave.Browser`, "browser was not detected");
    assert(
      (await readSettings(file)).browser === browser,
      "detected browser was not persisted",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("does not replace invalid settings or create missing detection", async () => {
  const root = await Deno.makeTempDir();
  const invalidFile = `${root}/invalid.toml`;
  const missingFile = `${root}/missing/config.toml`;
  try {
    await Deno.writeTextFile(invalidFile, '[settings]\nbrowser = ""\n');
    for (const file of [invalidFile, missingFile]) {
      let rejected = false;
      try {
        await resolveBrowserExecutable(undefined, {
          settingsFile: file,
          searchDirectories: [],
        });
      } catch {
        rejected = true;
      }
      assert(rejected, `${file} was unexpectedly resolved`);
    }
    assert(
      (await Deno.readTextFile(invalidFile)) ===
        '[settings]\nbrowser = ""\n',
      "invalid settings were replaced",
    );
    let missing = false;
    try {
      await Deno.stat(missingFile);
    } catch (error) {
      missing = error instanceof Deno.errors.NotFound;
    }
    assert(missing, "settings were created without a detected browser");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
