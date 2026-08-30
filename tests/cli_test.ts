import { readConfigFile, writeConfigFile } from "../src/config_file.ts";
import { emptyKonamateConfig } from "../src/models.ts";
import { desktopExecLine } from "../src/desktop_entry.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function outputText(output: Deno.CommandOutput): string {
  const decoder = new TextDecoder();
  return decoder.decode(output.stdout) + decoder.decode(output.stderr);
}

async function createExecutable(filePath: string): Promise<void> {
  await Deno.mkdir(filePath.substring(0, filePath.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeTextFile(filePath, "#!/bin/sh\nexit 1\n");
  await Deno.chmod(filePath, 0o755);
}

function runCli(
  xdgConfigHome: string,
  args: string[],
  home = xdgConfigHome,
  environment: Record<string, string> = {},
): Promise<Deno.CommandOutput> {
  return new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "src/main.ts", ...args],
    env: { XDG_CONFIG_HOME: xdgConfigHome, HOME: home, ...environment },
    stdout: "piped",
    stderr: "piped",
  }).output();
}

Deno.test("static help does not load unified configuration", async () => {
  const root = await Deno.makeTempDir();
  try {
    const directory = `${root}/konamate`;
    await Deno.mkdir(directory);
    await Deno.writeTextFile(`${directory}/config.toml`, "invalid = [");
    const help = await runCli(root, ["--help"]);
    assert(help.success, outputText(help));
    const games = await runCli(root, ["games"]);
    assert(!games.success, "invalid unified config was ignored");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("desktop entries preserve profile arguments and literal percent", () => {
  assert(
    desktopExecLine(
      "/path with space/konamate",
      "custom game",
      "my profile %u",
    ) ===
      '"/path with space/konamate" run "custom game" --profile "my profile %%u" --notify %u',
    "desktop Exec arguments were not encoded",
  );
});

Deno.test("settings reads and writes only the settings section", async () => {
  const root = await Deno.makeTempDir();
  try {
    const settings = await runCli(root, ["settings"]);
    assert(settings.success, outputText(settings));
    assert(outputText(settings).includes("{}"), "empty settings not shown");
    let missing = false;
    try {
      await Deno.stat(`${root}/konamate/config.toml`);
    } catch (error) {
      missing = error instanceof Deno.errors.NotFound;
    }
    assert(missing, "read-only settings created config.toml");

    const saved = await runCli(root, [
      "settings",
      "--browser",
      "/usr/bin/chromium",
    ]);
    assert(saved.success, outputText(saved));
    const config = await readConfigFile(`${root}/konamate/config.toml`);
    assert(
      config.settings.browser === "/usr/bin/chromium",
      "browser not saved",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("normal commands reject mixed JSON and TOML configuration", async () => {
  const root = await Deno.makeTempDir();
  try {
    const directory = `${root}/konamate`;
    await writeConfigFile(emptyKonamateConfig(), `${directory}/config.toml`);
    await Deno.writeTextFile(`${directory}/sdvx.json`, "{}");
    const settings = await runCli(root, [
      "settings",
      "--browser",
      "/usr/bin/chromium",
    ]);
    assert(!settings.success, "mixed configuration was accepted");
    assert(
      outputText(settings).includes("konamate migrate"),
      outputText(settings),
    );
    assert(
      (await readConfigFile(`${directory}/config.toml`)).settings.browser ===
        undefined,
      "mixed configuration modified config.toml",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("browser auto-detection rejects legacy JSON before writing TOML", async () => {
  const root = await Deno.makeTempDir();
  try {
    const directory = `${root}/konamate`;
    const bin = `${root}/bin`;
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeTextFile(`${directory}/config.json`, "{}");
    await createExecutable(`${bin}/chromium`);
    const auth = await runCli(
      root,
      ["auth", "register-passkey"],
      root,
      { PATH: bin },
    );
    assert(!auth.success, "legacy JSON was ignored during browser detection");
    assert(outputText(auth).includes("konamate migrate"), outputText(auth));
    await assertMissing(`${directory}/config.toml`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("custom games are loaded from config.toml", async () => {
  const root = await Deno.makeTempDir();
  try {
    const file = `${root}/konamate/config.toml`;
    const config = emptyKonamateConfig();
    config.games.custom = {
      id: "custom",
      name: "Custom Game",
      urlScheme: "custom.game",
      loginUrl: "https://example.com/login",
      registryKey: "Software\\Custom Game",
      common: { env: {}, registry: [] },
      profiles: {
        launcher: { command: "run %u", env: {}, registry: [] },
      },
      runProfile: "launcher",
    };
    await writeConfigFile(config, file);
    const games = await runCli(root, ["games", "--json"]);
    assert(games.success, outputText(games));
    assert(outputText(games).includes('"id": "custom"'), "custom game missing");
    const completion = await runCli(root, [
      "completions",
      "complete",
      "game",
      "run",
    ]);
    assert(completion.success, outputText(completion));
    assert(
      outputText(completion).split("\n").includes("custom"),
      "custom completion missing",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("profile commands manage common and inherited settings", async () => {
  const root = await Deno.makeTempDir();
  try {
    const settings = await runCli(root, [
      "settings",
      "--browser",
      "/usr/bin/chromium",
    ]);
    assert(settings.success, outputText(settings));
    const commonEnv = await runCli(root, [
      "profile",
      "env",
      "set",
      "sdvx",
      "common",
      "TEST",
      "common",
    ]);
    assert(commonEnv.success, outputText(commonEnv));
    const set = await runCli(root, [
      "profile",
      "set",
      "sdvx",
      "custom",
      "--command",
      "run %t",
      "--cwd",
      "/tmp/game",
    ]);
    assert(set.success, outputText(set));
    const emptySet = await runCli(root, [
      "profile",
      "set",
      "sdvx",
      "missing",
    ]);
    assert(!emptySet.success, "empty profile update succeeded");
    const unset = await runCli(root, [
      "profile",
      "env",
      "unset",
      "sdvx",
      "custom",
      "TEST",
    ]);
    assert(unset.success, outputText(unset));
    const hidden = await runCli(root, [
      "profile",
      "show",
      "sdvx",
      "custom",
      "--effective",
    ]);
    assert(hidden.success, outputText(hidden));
    assert(
      !outputText(hidden).includes('"TEST"'),
      "tombstone did not unset env",
    );
    const inherit = await runCli(root, [
      "profile",
      "env",
      "inherit",
      "sdvx",
      "custom",
      "TEST",
    ]);
    assert(inherit.success, outputText(inherit));
    const inherited = await runCli(root, [
      "profile",
      "show",
      "sdvx",
      "custom",
      "--effective",
    ]);
    assert(
      outputText(inherited).includes('"TEST": "common"'),
      "env not inherited",
    );

    const registrySet = await runCli(root, [
      "profile",
      "registry",
      "set",
      "sdvx",
      "common",
      "HKCU\\Software\\Wine\\Explorer",
      "Default",
      "--name",
      "Desktop",
    ]);
    assert(registrySet.success, outputText(registrySet));
    const registryDelete = await runCli(root, [
      "profile",
      "registry",
      "delete",
      "sdvx",
      "custom",
      "HKCU\\Software\\Wine\\Explorer",
      "--name",
      "Desktop",
    ]);
    assert(registryDelete.success, outputText(registryDelete));
    const effectiveRegistry = await runCli(root, [
      "profile",
      "registry",
      "list",
      "sdvx",
      "custom",
      "--effective",
    ]);
    assert(
      outputText(effectiveRegistry).includes('"action": "delete"'),
      "profile registry did not override common",
    );
    const registryRemove = await runCli(root, [
      "profile",
      "registry",
      "remove",
      "sdvx",
      "custom",
      "HKCU\\Software\\Wine\\Explorer",
      "--name",
      "Desktop",
    ]);
    assert(registryRemove.success, outputText(registryRemove));
    const restoredRegistry = await runCli(root, [
      "profile",
      "registry",
      "list",
      "sdvx",
      "custom",
      "--effective",
    ]);
    assert(
      outputText(restoredRegistry).includes('"action": "set"'),
      "common registry was not restored",
    );
    assert(
      (await readConfigFile(`${root}/konamate/config.toml`)).settings
        .browser ===
        "/usr/bin/chromium",
      "profile update discarded settings",
    );

    for (const removed of ["config", "registry"]) {
      const output = await runCli(root, [removed, "--help"]);
      assert(!output.success, `removed command '${removed}' still exists`);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("profile reads use defaults without initializing config.toml", async () => {
  const root = await Deno.makeTempDir();
  try {
    const listed = await runCli(root, ["profile", "list", "sdvx"]);
    assert(listed.success, outputText(listed));
    assert(outputText(listed).includes("launcher"), "default profile missing");
    await assertMissing(`${root}/konamate/config.toml`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("exec uses the selected effective profile", async () => {
  const root = await Deno.makeTempDir();
  try {
    const prefix = `${root}/prefix`;
    for (
      const [name, value] of [
        ["WINEPREFIX", prefix],
        ["VISIBLE", "yes"],
      ]
    ) {
      const set = await runCli(root, [
        "profile",
        "env",
        "set",
        "infinitas",
        "common",
        name,
        value,
      ]);
      assert(set.success, outputText(set));
    }
    const unset = await runCli(root, [
      "profile",
      "env",
      "unset",
      "infinitas",
      "game",
      "VISIBLE",
    ]);
    assert(unset.success, outputText(unset));
    const exec = await runCli(
      root,
      ["exec", "--profile", "game", "infinitas", "env"],
      root,
      { VISIBLE: "from-parent" },
    );
    const output = outputText(exec);
    assert(exec.success, output);
    assert(!output.includes("VISIBLE=yes"), "tombstoned env reached process");
    assert(
      output.includes(`file not found; skipping: ${prefix}/user.reg`),
      "effective registry was not applied",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function assertMissing(file: string): Promise<void> {
  try {
    await Deno.stat(file);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error(`${file} unexpectedly exists`);
}
