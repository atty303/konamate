function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function outputText(output: Deno.CommandOutput): string {
  const decoder = new TextDecoder();
  return decoder.decode(output.stdout) + decoder.decode(output.stderr);
}

function runCli(
  xdgConfigHome: string,
  args: string[],
): Promise<Deno.CommandOutput> {
  return new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "src/main.ts", ...args],
    env: { XDG_CONFIG_HOME: xdgConfigHome },
    stdout: "piped",
    stderr: "piped",
  }).output();
}

Deno.test("static commands do not load game definitions", async () => {
  const xdgConfigHome = await Deno.makeTempDir();
  try {
    const configDir = `${xdgConfigHome}/konamate`;
    await Deno.mkdir(configDir);
    await Deno.writeTextFile(`${configDir}/games.json`, "not json");

    const rootHelp = await runCli(xdgConfigHome, ["--help"]);
    assert(rootHelp.success, outputText(rootHelp));
    assert(outputText(rootHelp).includes("run"), "run command is missing");

    const games = await runCli(xdgConfigHome, ["games"]);
    assert(!games.success, "invalid game definitions were ignored");
  } finally {
    await Deno.remove(xdgConfigHome, { recursive: true });
  }
});

Deno.test("settings reports no saved values in a new environment", async () => {
  const xdgConfigHome = await Deno.makeTempDir();
  try {
    const settings = await runCli(xdgConfigHome, ["settings"]);
    assert(settings.success, outputText(settings));
    assert(
      outputText(settings).includes("{}"),
      "missing settings were not reported as an empty object",
    );
    let created = false;
    try {
      await Deno.stat(`${xdgConfigHome}/konamate/config.json`);
      created = true;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    assert(
      !created,
      "settings command created configuration without an option",
    );
  } finally {
    await Deno.remove(xdgConfigHome, { recursive: true });
  }
});

Deno.test("custom games are validated and completed as arguments", async () => {
  const xdgConfigHome = await Deno.makeTempDir();
  try {
    const configDir = `${xdgConfigHome}/konamate`;
    await Deno.mkdir(configDir);
    await Deno.writeTextFile(
      `${configDir}/games.json`,
      JSON.stringify([{
        id: "custom",
        name: "Custom Game",
        urlScheme: "custom.game",
        loginUrl: "https://example.com/login",
        registryKey: "Software\\Custom Game",
        profiles: { launcher: { command: "run %u" } },
        runProfile: "launcher",
      }]),
    );

    const games = await runCli(xdgConfigHome, ["games", "--json"]);
    assert(games.success, outputText(games));
    assert(
      outputText(games).includes('"id": "custom"'),
      "custom game is missing",
    );

    const completions = await runCli(xdgConfigHome, [
      "completions",
      "complete",
      "game",
      "run",
    ]);
    assert(completions.success, outputText(completions));
    assert(
      outputText(completions).split("\n").includes("custom"),
      "custom game completion is missing",
    );

    for (const oldCommand of ["sdvx", "ls", "browser"]) {
      const output = await runCli(xdgConfigHome, [oldCommand, "--help"]);
      assert(
        !output.success,
        `legacy command '${oldCommand}' is still available`,
      );
    }

    const authHelp = await runCli(xdgConfigHome, ["auth", "--help"]);
    assert(authHelp.success, outputText(authHelp));
    assert(
      !outputText(authHelp).includes("launch"),
      "hidden auth command is visible",
    );
    const hiddenLaunch = await runCli(xdgConfigHome, [
      "auth",
      "launch",
      "--help",
    ]);
    assert(hiddenLaunch.success, outputText(hiddenLaunch));
    const upgrade = await runCli(xdgConfigHome, ["upgrade", "--help"]);
    assert(upgrade.success, outputText(upgrade));
  } finally {
    await Deno.remove(xdgConfigHome, { recursive: true });
  }
});

Deno.test("profile subcommands update configuration explicitly", async () => {
  const xdgConfigHome = await Deno.makeTempDir();
  try {
    const configure = await runCli(xdgConfigHome, [
      "config",
      "sdvx",
      "--env.TEST=value",
    ]);
    assert(configure.success, outputText(configure));

    const set = await runCli(xdgConfigHome, [
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
    const setDefault = await runCli(xdgConfigHome, [
      "profile",
      "default",
      "sdvx",
      "custom",
    ]);
    assert(setDefault.success, outputText(setDefault));

    const list = await runCli(xdgConfigHome, ["profile", "list", "sdvx"]);
    assert(list.success, outputText(list));
    assert(
      outputText(list).includes("custom (default)"),
      "default is not listed",
    );

    const ambiguous = await runCli(xdgConfigHome, [
      "profile",
      "default",
      "sdvx",
      "custom",
      "--unset",
    ]);
    assert(!ambiguous.success, "ambiguous default operation was accepted");
    const unset = await runCli(xdgConfigHome, [
      "profile",
      "default",
      "sdvx",
      "--unset",
    ]);
    assert(unset.success, outputText(unset));
    const deleteProfile = await runCli(xdgConfigHome, [
      "profile",
      "delete",
      "sdvx",
      "custom",
    ]);
    assert(deleteProfile.success, outputText(deleteProfile));

    const stored = JSON.parse(
      await Deno.readTextFile(`${xdgConfigHome}/konamate/sdvx.json`),
    );
    assert(stored.runProfile === null, "default profile was not unset");
    assert(
      !Object.hasOwn(stored.profiles, "custom"),
      "profile was not deleted",
    );
  } finally {
    await Deno.remove(xdgConfigHome, { recursive: true });
  }
});

Deno.test("registry subcommands store declarative settings", async () => {
  const xdgConfigHome = await Deno.makeTempDir();
  try {
    const initialize = await runCli(xdgConfigHome, [
      "config",
      "infinitas",
      "--env.TEST=registry",
    ]);
    assert(initialize.success, outputText(initialize));
    const set = await runCli(xdgConfigHome, [
      "registry",
      "set",
      "infinitas",
      "HKCU\\Software\\Wine\\Explorer",
      "Default",
      "--name",
      "Desktop",
    ]);
    assert(set.success, outputText(set));

    const list = await runCli(xdgConfigHome, ["registry", "list", "infinitas"]);
    assert(list.success, outputText(list));
    assert(
      outputText(list).includes('"Desktop"'),
      "registry setting is not listed",
    );

    const remove = await runCli(xdgConfigHome, [
      "registry",
      "delete",
      "infinitas",
      "HKCU\\Software\\Wine\\Explorer",
      "--name",
      "Desktop",
    ]);
    assert(remove.success, outputText(remove));
    const stored = JSON.parse(
      await Deno.readTextFile(`${xdgConfigHome}/konamate/infinitas.json`),
    );
    const desktop = stored.registry.find((
      entry: { key: string; name: string },
    ) =>
      entry.key === "HKCU\\Software\\Wine\\Explorer" && entry.name === "Desktop"
    );
    assert(desktop?.action === "delete", "registry deletion was not stored");
  } finally {
    await Deno.remove(xdgConfigHome, { recursive: true });
  }
});

Deno.test("exec warns and continues when a registry file is absent", async () => {
  const xdgConfigHome = await Deno.makeTempDir();
  try {
    const prefix = `${xdgConfigHome}/uninitialized-prefix`;
    const initialize = await runCli(xdgConfigHome, [
      "config",
      "infinitas",
      `--env.WINEPREFIX=${prefix}`,
    ]);
    assert(initialize.success, outputText(initialize));

    const exec = await runCli(xdgConfigHome, ["exec", "infinitas", "true"]);
    const output = outputText(exec);
    assert(exec.success, output);
    assert(
      output.includes(`file not found; skipping: ${prefix}/user.reg`),
      "missing registry file warning was not shown",
    );
  } finally {
    await Deno.remove(xdgConfigHome, { recursive: true });
  }
});
