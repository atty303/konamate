import * as path from "@std/path";
import xdg from "@404wolf/xdg-portable";
import { colors } from "@cliffy/ansi/colors";
import { Command, ValidationError } from "@cliffy/command";
import {
  GameConfig,
  readConfig,
  resolveRunProfile,
  tryReadConfig,
  updateProfile,
  updateRegistry,
  writeConfig,
} from "./config.ts";
import $ from "@david/dax";
import { GameDefinition } from "./games.ts";
import { RegistryService } from "./registry.ts";
import { startProxy } from "./obs.ts";
import {
  expandLaunchCommand,
  needsInstallDir,
  parseLaunchUrl,
  resolveProfileCwd,
  winPathToUnix,
} from "./launch.ts";
import { obtainLaunchUrl } from "./browser.ts";
import { DEFAULT_PASSKEY_NAME, KEYRING_SERVICE } from "./app.ts";

export type GameResolver = (id: string) => GameDefinition;

function resolveGameArgument(
  resolveGame: GameResolver,
  game: unknown,
): GameDefinition {
  if (typeof game !== "string") throw new Error("Game ID must be a string");
  return resolveGame(game);
}

export function configCommand(resolveGame: GameResolver) {
  return new Command()
    .description("Set configuration for the game")
    .option(
      "--env.* [value:string]",
      "Set environment variable (empty value to unset)",
    )
    .arguments("<game:game>")
    .example("Show current configuration", "konamate config infinitas")
    .example(
      "Set environment variables",
      "konamate config infinitas --env.WINEPREFIX=/path/to/prefix",
    )
    .action(async (options, game) => {
      const def = resolveGameArgument(resolveGame, game);
      const defaultConfig = {
        env: {
          WINEPREFIX: path.join(
            Deno.env.get("HOME") ?? "",
            "Games",
            "konamate",
            def.id,
          ),
          GAMEID: `umu-${def.id}`,
        },
        profiles: def.profiles,
        registry: [],
        runProfile: def.runProfile,
      };
      const config0: GameConfig = {
        ...defaultConfig,
        ...(await tryReadConfig(def) ?? {}),
      };
      const env = { ...config0.env };
      for (const [key, value] of Object.entries(options.env ?? {})) {
        if (value === true) delete env[key];
        else if (typeof value === "string") env[key] = value;
      }
      const config: GameConfig = {
        ...config0,
        env,
      };

      $.log(JSON.stringify(config, null, 2));
      if (Object.keys(options).length === 0) {
        return;
      }

      await writeConfig(def.id, config);
      $.logStep(`Configuration for ${def.id} saved`);
    });
}

function registryService(config: GameConfig): RegistryService {
  const prefix = config.env.WINEPREFIX;
  if (!prefix) {
    throw new Error("WINEPREFIX is not set in the game configuration");
  }
  return new RegistryService(prefix);
}

async function applyRegistry(config: GameConfig): Promise<void> {
  if (config.registry.length === 0) return;
  await registryService(config).apply(config.registry);
}

export function registryCommand(resolveGame: GameResolver) {
  const list = new Command()
    .description("List declared registry settings")
    .arguments("<game:game>")
    .action(async (_, game) => {
      const config = await readConfig(resolveGameArgument(resolveGame, game));
      $.log(JSON.stringify(config.registry, null, 2));
    });

  const set = new Command()
    .description("Declare a registry value")
    .option("--name <name:string>", "Registry value name", { default: "" })
    .option("--type <type:string>", "Registry value type", {
      default: "string",
    })
    .arguments("<game:game> <key:string> <value:string>")
    .action(async (options, game, key, value) => {
      const def = resolveGameArgument(resolveGame, game);
      const type = options.type;
      if (type !== "string" && type !== "dword") {
        throw new Error("Registry type must be string or dword");
      }
      const parsedValue = type === "dword" ? Number(value) : value;
      const config = updateRegistry(await readConfig(def), {
        action: "set",
        key,
        name: options.name,
        type,
        value: parsedValue,
      });
      await writeConfig(def.id, config);
      $.logStep(`Registry setting for ${def.id} saved`);
    });

  const remove = new Command()
    .description("Declare a registry value absent")
    .option("--name <name:string>", "Registry value name", { default: "" })
    .arguments("<game:game> <key:string>")
    .action(async (options, game, key) => {
      const def = resolveGameArgument(resolveGame, game);
      const config = updateRegistry(await readConfig(def), {
        action: "delete",
        key,
        name: options.name,
      });
      await writeConfig(def.id, config);
      $.logStep(`Registry deletion for ${def.id} saved`);
    });

  const apply = new Command()
    .description("Apply declared registry settings to the Wine prefix")
    .arguments("<game:game>")
    .action(async (_, game) => {
      const config = await readConfig(resolveGameArgument(resolveGame, game));
      await applyRegistry(config);
      $.logStep("Registry settings applied");
    });

  return new Command()
    .description("Manage declared Wine registry settings")
    .command("list", list)
    .command("set", set)
    .command("delete", remove)
    .command("apply", apply);
}

function profileDescription(): string {
  return `Manage launch profiles for a game

command string supports the following placeholders:
  %u: URL passed to the game
  %t: Token from the URL
  %r: Installation directory as windows format (e.g. C:\\Games)
  %{id}: Game ID (e.g. 'infinitas', 'sdvx', etc.)
  `;
}

function logProfiles(config: GameConfig): void {
  $.log("Available profiles:");
  for (const [name, profile] of Object.entries(config.profiles)) {
    const isDefault = config.runProfile === name;
    $.log(
      `${
        isDefault ? colors.red.bold(`${name} (default)`) : colors.yellow(name)
      }: ${profile.command}`,
    );
  }
}

export function profileCommand(resolveGame: GameResolver) {
  const list = new Command()
    .description("List launch profiles")
    .arguments("<game:game>")
    .action(async (_, game) => {
      logProfiles(await readConfig(resolveGameArgument(resolveGame, game)));
    });

  const set = new Command()
    .description("Create or replace a launch profile")
    .option("--command <command:string>", "Launch command", {
      required: true,
    })
    .option("--cwd <dir:file>", "Working directory for the profile")
    .arguments("<game:game> <name:string>")
    .action(async (options, game, name) => {
      const def = resolveGameArgument(resolveGame, game);
      const config = updateProfile(await readConfig(def), {
        name,
        command: options.command,
        cwd: options.cwd,
      });
      await writeConfig(def.id, config);
      $.logStep(`Configuration for ${def.id} saved`);
    });

  const deleteProfile = new Command()
    .description("Delete a launch profile")
    .arguments("<game:game> <name:string>")
    .action(async (_, game, name) => {
      const def = resolveGameArgument(resolveGame, game);
      const config = updateProfile(await readConfig(def), {
        name,
        delete: true,
      });
      await writeConfig(def.id, config);
      $.logStep(`Configuration for ${def.id} saved`);
    });

  const defaultProfile = new Command()
    .description("Set or unset the default launch profile")
    .option("--unset", "Unset the default profile")
    .arguments("<game:game> [name:string]")
    .action(async (options, game, name) => {
      if (options.unset === (name !== undefined)) {
        throw new ValidationError(
          "Provide either a profile name or --unset",
        );
      }
      const def = resolveGameArgument(resolveGame, game);
      const config = updateProfile(await readConfig(def), {
        name,
        setDefault: true,
      });
      await writeConfig(def.id, config);
      $.logStep(`Configuration for ${def.id} saved`);
    });

  return new Command()
    .description(profileDescription())
    .command("list", list)
    .command("set", set)
    .command("delete", deleteProfile)
    .command("default", defaultProfile);
}

async function extractIcon(
  def: GameDefinition,
  config: GameConfig,
  dest: string,
): Promise<void> {
  const iconValue = await registryService(config).readLocalMachine(
    `Software\\Classes\\${def.urlScheme}\\DefaultIcon`,
    "",
  );
  const [pathInWin, index] = (() => {
    if (iconValue && iconValue.type === "REG_SZ") {
      const [path, index] = iconValue.data.split(",");
      return [path, parseInt(index, 10)] as const;
    } else {
      return [undefined, undefined] as const;
    }
  })();

  $.logLight(`Icon path in Windows: ${pathInWin}, icon index: ${index}`);
  if (!pathInWin) {
    throw new Error(`No icon found for ${def.urlScheme} in registry`);
  }

  const absPath = winPathToUnix(pathInWin, config.env.WINEPREFIX);
  $.logLight(`Absolute path to icon: ${absPath}`);

  const name = `${absPath}[${index}]`;
  await $`magick ${name} ${dest}`.printCommand();
}

export function associateCommand(resolveGame: GameResolver) {
  return new Command()
    .description("Associate a game URL scheme with the game")
    .option("--self-path <path:file>", "Path to the this executable")
    .arguments("<game:game>")
    .action(async (options, game) => {
      const def = resolveGameArgument(resolveGame, game);
      // If run as a Deno script, require the --self-path option
      const selfPath = Deno.execPath().includes("deno")
        ? options.selfPath
        : Deno.execPath();
      if (!selfPath) {
        throw new Error("--self-path is required");
      }

      const config = await readConfig(def);

      $.logStep(`Extracting icon for ${def.id}`);
      const iconName = await (async () => {
        try {
          const dest = path.join(xdg.data(), "icons", `${def.id}.png`);
          await $.path(dest).parent()?.ensureDir();
          await extractIcon(def, config, dest);
          return def.id;
        } catch (err) {
          $.logWarn(
            `Failed to extract icon. Your desktop entry may not have an icon: ${err}`,
          );
        }
      })();

      const dir = await Deno.makeTempDir();
      try {
        const filename = `${def.id}.desktop`;

        const mimeType = `x-scheme-handler/${def.urlScheme}`;
        const desktopPath = path.join(dir, filename);

        const body = `[Desktop Entry]
Name=${def.name}
${
          def.nameLocalized
            ? Object.entries(def.nameLocalized).map(([lang, name]) =>
              `Name[${lang}]=${name}`
            ).join("\n")
            : ""
        }
Comment=Play ${def.name} on Konaste
Exec=${selfPath} run ${def.id} --notify %u
Type=Application
Categories=Game;
Terminal=false
StartupNotify=true
MimeType=${mimeType};
${iconName ? `Icon=${iconName}` : ""}`;

        $.logStep("Installing desktop entry");

        $.logLight(`Desktop entry content:\n${body}`);
        await $.path(desktopPath).writeText(body);

        const applicationPath = path.join(
          xdg.data(),
          "applications",
        );
        await $`desktop-file-install --dir=${applicationPath} --delete-original --rebuild-mime-info-cache ${desktopPath}`
          .printCommand();
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
      //      await $`xdg-mime default ${filename} ${mimeType}`.printCommand();

      $.logStep("Successfully created desktop entry");
    });
}

export function execCommand(resolveGame: GameResolver) {
  return new Command()
    .description("Run a command in same environment as the `run` subcommand")
    .arguments("<game:game> <...command:string>")
    .action(async (_, game, ...command) => {
      const def = resolveGameArgument(resolveGame, game);
      const config = await readConfig(def);
      await applyRegistry(config);
      await $.raw`${command.join(" ")}`.env(config.env).printCommand();
    });
}

async function selectProfileWithNotification(
  def: GameDefinition,
  names: string[],
): Promise<string | undefined> {
  const actions = names.map((name) => $.escapeArg(`--action=${name}=${name}`));
  const selected =
    await $`notify-send --app-name ${def.name} --urgency=critical --icon=${def.id} ${
      $.rawArg(actions)
    } ${"Select a profile to run"}`.noThrow().text();
  $.logLight(`Selected profile: ${JSON.stringify(selected)}`);
  return selected;
}

function selectProfileInTerminal(names: string[]): Promise<string | undefined> {
  console.log("Available profiles:");
  names.forEach((name, index) => console.log(`  ${index + 1}. ${name}`));
  const answer = prompt("Select a profile by name or number:")?.trim();
  if (!answer) return Promise.resolve(undefined);
  const index = Number(answer);
  return Promise.resolve(
    Number.isInteger(index) && index >= 1 && index <= names.length
      ? names[index - 1]
      : answer,
  );
}

export function runCommand(resolveGame: GameResolver) {
  return new Command()
    .description(
      "Authenticate in the configured browser and run the game, or run a supplied launch URL",
    )
    .option(
      "--browser <exe:file>",
      "Override the configured browser executable",
    )
    .option("--profile <name:string>", "Launch profile to use")
    .option("--notify", "Use desktop notifications and profile selection")
    .option(
      "--passkey-service <service:string>",
      "Service name for the passkey",
      { default: KEYRING_SERVICE },
    )
    .option("--passkey-name <name:string>", "Name of the passkey", {
      default: DEFAULT_PASSKEY_NAME,
    })
    .arguments("<game:game> [url:string]")
    .action(async (options, game, url) => {
      const def = resolveGameArgument(resolveGame, game);
      const config = await readConfig(def);
      await applyRegistry(config);
      const selector = options.notify
        ? (names: string[]) => selectProfileWithNotification(def, names)
        : Deno.stdin.isTerminal() && Deno.stdout.isTerminal()
        ? selectProfileInTerminal
        : undefined;
      const selectedProfileName = await resolveRunProfile(
        config,
        options.profile,
        selector,
      );

      if (!url) {
        url = await obtainLaunchUrl({
          browser: options.browser,
          url: def.loginUrl,
          scheme: def.urlScheme,
          passkeyService: options.passkeyService,
          passkeyName: options.passkeyName,
        });
      }

      $.logStep(`Launching ${def.id} with URL: ${url}`);

      if (options.notify) {
        await $`notify-send --app-name ${def.name} --urgency=low --icon=${def.id} --expire-time=5000 "Launching ${def.name}"`
          .noThrow();
      }

      const launchUrl = parseLaunchUrl(url, def.urlScheme);

      const profile = config.profiles[selectedProfileName];
      if (!profile) {
        throw new Error(
          `Run profile '${selectedProfileName}' not found for ${def.id}`,
        );
      }

      const installDir = await (async () => {
        if (!needsInstallDir(profile.command, profile.cwd)) return undefined;

        const value = await registryService(config).readLocalMachine(
          def.registryKey,
          "InstallDir",
        );
        if (typeof value?.data !== "string") {
          throw new Error(
            `Installation directory not found in registry for ${def.id}`,
          );
        }
        return value.data;
      })();
      if (installDir !== undefined) {
        $.logLight(`Install directory: ${installDir}`);
      }

      const command = expandLaunchCommand(profile.command, {
        url: launchUrl.raw,
        token: launchUrl.token,
        installDir,
        metadata: def,
      });
      const cwd = resolveProfileCwd(
        profile.cwd,
        installDir,
        config.env.WINEPREFIX,
      );

      const cmd0 = $.raw`${command}`.env(config.env).printCommand();
      const cmd = cwd ? cmd0.cwd(cwd) : cmd0;
      await cmd;
    });
}

function winePathToUnix(winePath: string, winePrefix: string): string {
  let drivePath = winePath;
  if (winePath.length >= 2 && winePath[1] === ":") {
    // Wine path like "Z:\path\to\file"
    drivePath = winePath.substring(0, 1).toLowerCase() + winePath.substring(1);
  }
  const unixPath = `${winePrefix}/dosdevices/${drivePath.replace(/\\/g, "/")}`;
  return unixPath;
}

export function obsWebSocketProxyCommand(resolveGame: GameResolver) {
  return new Command()
    .description($.dedent`
      Start a WebSocket proxy for OBS

      Intended to be used with analyzer tools like sdvx-helper running inside Wine.
      Such tools can connect to this proxy and send commands to OBS.
      Currently, it only transforms the SaveSourceScreenshot request to use a Unix path.
    `)
    .option("--obs-url <url>", "URL of the OBS WebSocket server", {
      required: true,
      default: "ws://127.0.0.1:4455",
    })
    .option(
      "--hostname <hostname:string>",
      "Hostname for the WebSocket proxy",
      {
        required: true,
        default: "127.0.0.1",
      },
    )
    .option("--port <port:number>", "Port for the WebSocket proxy", {
      required: true,
      default: 4456,
    })
    .option("-v, --verbose", "Enable verbose logging")
    .arguments("<game:game>")
    .action(async (options, game) => {
      const def = resolveGameArgument(resolveGame, game);
      const config = await readConfig(def);
      if (!config.env.WINEPREFIX) {
        throw new Error(
          `WINEPREFIX is not set in the configuration for ${def.id}`,
        );
      }

      await startProxy({
        ...options,
        transform: (data) => {
          const request = JSON.parse(data);
          if (request?.d?.requestType === "SaveSourceScreenshot") {
            const winePath = request.d?.requestData?.imageFilePath;
            const unixPath = winePathToUnix(winePath, config.env.WINEPREFIX);
            request.d.requestData.imageFilePath = unixPath;
          }
          return Promise.resolve(JSON.stringify(request));
        },
      });
    });
}
