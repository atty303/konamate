import {
  parseConfigToml,
  readConfigFile,
  stringifyConfigToml,
  writeConfigFile,
} from "../src/config_file.ts";
import { emptyKonamateConfig } from "../src/models.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("unified TOML round trips settings games and profiles", async () => {
  const root = await Deno.makeTempDir();
  try {
    const config = emptyKonamateConfig();
    config.settings.browser = "/usr/bin/chromium";
    config.games.custom = {
      id: "custom",
      name: "Custom",
      urlScheme: "custom.game",
      loginUrl: "https://example.com/login",
      registryKey: "Software\\Custom",
      common: { env: {}, registry: [] },
      profiles: {
        launcher: { command: "run %u", env: {}, registry: [] },
      },
      runProfile: "launcher",
    };
    config.profiles.custom = {
      common: { env: { WINEPREFIX: "/tmp/custom" }, registry: [] },
      profiles: {
        launcher: {
          command: "run %u",
          env: { DISABLED: "" },
          registry: [],
        },
      },
      runProfile: null,
    };
    const body = stringifyConfigToml(config);
    assert(body.includes("url_scheme"), "snake_case was not serialized");
    assert(!body.includes("runProfile"), "camelCase leaked to TOML");
    const parsed = parseConfigToml(body);
    assert(parsed.games.custom.id === "custom", "game ID was not restored");
    assert(
      parsed.profiles.custom.runProfile === null,
      "missing run_profile was not normalized",
    );

    const file = `${root}/config.toml`;
    await writeConfigFile(config, file);
    const info = await Deno.stat(file);
    assert((info.mode! & 0o777) === 0o600, "config permission is not 0600");
    assert(
      (await readConfigFile(file)).settings.browser === "/usr/bin/chromium",
      "written config was not readable",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("invalid TOML and schema errors identify the file", () => {
  for (
    const [body, pattern] of [
      ["invalid = [", /Invalid TOML in custom\.toml/],
      ['[settings]\nbrowser = ""', /Invalid data in custom\.toml/],
      [
        '[profiles.sample.common]\nregistry = []\n[profiles.sample.common.env]\n[profiles.sample.entries.game]\ncommand = "run"\ncwwd = "/lost"',
        /cwwd/,
      ],
      [
        '[games.sample]\nname = "Sample"\nurl_scheme = "sample.game"\nurlScheme = "ignored"\nlogin_url = "https://example.com/login"\nregistry_key = "Software\\\\Sample"\nrun_profile = "launcher"\n[games.sample.common]\nregistry = []\n[games.sample.common.env]\n[games.sample.profiles.launcher]\ncommand = "run"\nregistry = []\n[games.sample.profiles.launcher.env]',
        /urlScheme/,
      ],
    ] as const
  ) {
    let rejected = false;
    try {
      parseConfigToml(body, "custom.toml");
    } catch (error) {
      rejected = error instanceof Error && pattern.test(error.message);
    }
    assert(rejected, `input was not rejected with ${pattern}`);
  }
});
