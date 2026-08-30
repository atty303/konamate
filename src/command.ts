import * as path from "@std/path";
import xdg from "@404wolf/xdg-portable";
import { colors } from "@cliffy/ansi/colors";
import { Command, ValidationError } from "@cliffy/command";
import {
  EffectiveProfile,
  GameConfig,
  readConfig,
  resolveEffectiveProfile,
  resolveProcessEnvironment,
  resolveRunProfile,
  resolveTarget,
  setDefaultProfile,
  updateConfig,
  updateEnvironment,
  updateProfile,
  updateRegistry,
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
import { desktopExecLine } from "./desktop_entry.ts";

export type GameResolver = (id: string) => GameDefinition;

function resolveGameArgument(
  resolveGame: GameResolver,
  game: unknown,
): GameDefinition {
  if (typeof game !== "string") throw new Error("Game ID must be a string");
  return resolveGame(game);
}

type RegistryTarget = Pick<EffectiveProfile, "env" | "registry">;

function registryService(config: RegistryTarget): RegistryService {
  const prefix = config.env.WINEPREFIX;
  if (!prefix) {
    throw new Error("WINEPREFIX is not set in the game configuration");
  }
  return new RegistryService(prefix);
}

async function applyRegistry(config: RegistryTarget): Promise<void> {
  if (config.registry.length === 0) return;
  await registryService(config).apply(config.registry);
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
  const definition = (game: unknown) => resolveGameArgument(resolveGame, game);
  const save = async (
    game: unknown,
    update: (config: GameConfig) => GameConfig,
  ) => {
    const def = definition(game);
    await updateConfig(def, update);
    $.logStep(`Profile configuration for ${def.id} saved`);
  };

  const list = new Command()
    .description("List launch profiles")
    .arguments("<game:game>")
    .action(async (_, game) => {
      logProfiles(await readConfig(resolveGameArgument(resolveGame, game)));
    });

  const show = new Command()
    .description("Show stored or effective profile configuration")
    .option("--effective", "Resolve common settings into the profile")
    .arguments("<game:game> <profile:string>")
    .action(async (options, game, profile) => {
      const config = await readConfig(definition(game));
      $.log(
        JSON.stringify(
          resolveTarget(config, profile, options.effective),
          null,
          2,
        ),
      );
    });

  const set = new Command()
    .description("Create or partially update a launch profile")
    .option("--command <command:string>", "Launch command")
    .option("--cwd <dir:file>", "Working directory for the profile")
    .option("--unset-cwd", "Remove the working directory", {
      conflicts: ["cwd"],
    })
    .arguments("<game:game> <profile:string>")
    .action(async (options, game, profile) => {
      await save(game, (config) =>
        updateProfile(config, {
          name: profile,
          command: options.command,
          cwd: options.cwd,
          unsetCwd: options.unsetCwd,
        }));
    });

  const deleteProfile = new Command()
    .description("Delete a launch profile")
    .arguments("<game:game> <profile:string>")
    .action(async (_, game, profile) => {
      await save(game, (config) =>
        updateProfile(config, {
          name: profile,
          delete: true,
        }));
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
      await save(game, (config) => setDefaultProfile(config, name ?? null));
    });

  const envSet = new Command()
    .description("Set a common or profile environment variable")
    .arguments("<game:game> <profile:string> <name:string> <value:string>")
    .action(async (_, game, profile, name, value) => {
      await save(
        game,
        (config) => updateEnvironment(config, profile, name, "set", value),
      );
    });
  const envUnset = new Command()
    .description("Unset an environment variable in a profile")
    .arguments("<game:game> <profile:string> <name:string>")
    .action(async (_, game, profile, name) => {
      await save(
        game,
        (config) => updateEnvironment(config, profile, name, "unset"),
      );
    });
  const envInherit = new Command()
    .description("Remove a profile override and inherit the common value")
    .arguments("<game:game> <profile:string> <name:string>")
    .action(async (_, game, profile, name) => {
      await save(
        game,
        (config) => updateEnvironment(config, profile, name, "inherit"),
      );
    });
  const env = new Command()
    .description("Manage profile environment variables")
    .command("set", envSet)
    .command("unset", envUnset)
    .command("inherit", envInherit);

  const registryList = new Command()
    .description("List stored or effective registry declarations")
    .option("--effective", "Include inherited common declarations")
    .arguments("<game:game> <profile:string>")
    .action(async (options, game, profile) => {
      const config = await readConfig(definition(game));
      const target = resolveTarget(config, profile, options.effective);
      $.log(JSON.stringify(target.registry, null, 2));
    });
  const registrySet = new Command()
    .description("Declare a registry value")
    .option("--name <name:string>", "Registry value name", { default: "" })
    .option("--type <type:string>", "Registry value type", {
      default: "string",
    })
    .arguments("<game:game> <profile:string> <key:string> <value:string>")
    .action(async (options, game, profile, key, value) => {
      if (options.type !== "string" && options.type !== "dword") {
        throw new Error("Registry type must be string or dword");
      }
      const type = options.type;
      await save(game, (config) =>
        updateRegistry(config, profile, {
          action: "set",
          key,
          name: options.name,
          type,
          value: type === "dword" ? Number(value) : value,
        }));
    });
  const registryDelete = new Command()
    .description("Declare a registry value absent")
    .option("--name <name:string>", "Registry value name", { default: "" })
    .arguments("<game:game> <profile:string> <key:string>")
    .action(async (options, game, profile, key) => {
      await save(game, (config) =>
        updateRegistry(config, profile, {
          action: "delete",
          key,
          name: options.name,
        }));
    });
  const registryRemove = new Command()
    .description("Remove a declaration and inherit the common declaration")
    .option("--name <name:string>", "Registry value name", { default: "" })
    .arguments("<game:game> <profile:string> <key:string>")
    .action(async (options, game, profile, key) => {
      await save(game, (config) =>
        updateRegistry(config, profile, undefined, {
          key,
          name: options.name,
        }));
    });
  const registryApply = new Command()
    .description("Apply effective registry declarations")
    .arguments("<game:game> <profile:string>")
    .action(async (_, game, profile) => {
      const config = await readConfig(definition(game));
      const target = profile === "common"
        ? config.common
        : resolveEffectiveProfile(config, profile);
      await applyRegistry(target);
      $.logStep("Registry settings applied");
    });
  const registry = new Command()
    .description("Manage profile registry declarations")
    .command("list", registryList)
    .command("set", registrySet)
    .command("delete", registryDelete)
    .command("remove", registryRemove)
    .command("apply", registryApply);

  return new Command()
    .description(profileDescription())
    .command("list", list)
    .command("show", show)
    .command("set", set)
    .command("delete", deleteProfile)
    .command("default", defaultProfile)
    .command("env", env)
    .command("registry", registry);
}

async function extractIcon(
  def: GameDefinition,
  config: EffectiveProfile,
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
    .option("--profile <name:string>", "Launch profile used to locate the icon")
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
      const selected = await resolveRunProfile(
        config,
        options.profile,
        Deno.stdin.isTerminal() && Deno.stdout.isTerminal()
          ? selectProfileInTerminal
          : undefined,
      );
      const effective = resolveEffectiveProfile(config, selected);

      $.logStep(`Extracting icon for ${def.id}`);
      const iconName = await (async () => {
        try {
          const dest = path.join(xdg.data(), "icons", `${def.id}.png`);
          await $.path(dest).parent()?.ensureDir();
          await extractIcon(def, effective, dest);
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
Exec=${desktopExecLine(selfPath, def.id, selected)}
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
    .option("--profile <name:string>", "Launch profile to use")
    .arguments("<game:game> <...command:string>")
    .action(async (options, game, ...command) => {
      const def = resolveGameArgument(resolveGame, game);
      const config = await readConfig(def);
      const selected = await resolveRunProfile(
        config,
        options.profile,
        Deno.stdin.isTerminal() && Deno.stdout.isTerminal()
          ? selectProfileInTerminal
          : undefined,
      );
      const effective = resolveEffectiveProfile(config, selected);
      await applyRegistry(effective);
      await $.raw`${command.join(" ")}`.env(
        resolveProcessEnvironment(config, selected),
      ).printCommand();
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
      const profile = resolveEffectiveProfile(config, selectedProfileName);
      await applyRegistry(profile);

      if (!url) {
        url = await obtainLaunchUrl({
          browser: options.browser,
          url: def.loginUrl,
          scheme: def.urlScheme,
          passkeyService: options.passkeyService,
          passkeyName: options.passkeyName,
        });
      }

      $.logStep(`Launching ${def.id} with profile ${selectedProfileName}`);

      if (options.notify) {
        await $`notify-send --app-name ${def.name} --urgency=low --icon=${def.id} --expire-time=5000 "Launching ${def.name}"`
          .noThrow();
      }

      const launchUrl = parseLaunchUrl(url, def.urlScheme);

      const installDir = await (async () => {
        if (!needsInstallDir(profile.command, profile.cwd)) return undefined;

        const value = await registryService(profile).readLocalMachine(
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
        profile.env.WINEPREFIX,
      );

      const cmd0 = $.raw`${command}`.env(
        resolveProcessEnvironment(config, selectedProfileName),
      ).printCommand();
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
    .option("--profile <name:string>", "Launch profile to use")
    .arguments("<game:game>")
    .action(async (options, game) => {
      const def = resolveGameArgument(resolveGame, game);
      const config = await readConfig(def);
      const selected = await resolveRunProfile(
        config,
        options.profile,
        Deno.stdin.isTerminal() && Deno.stdout.isTerminal()
          ? selectProfileInTerminal
          : undefined,
      );
      const effective = resolveEffectiveProfile(config, selected);
      if (!effective.env.WINEPREFIX) {
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
            const unixPath = winePathToUnix(
              winePath,
              effective.env.WINEPREFIX,
            );
            request.d.requestData.imageFilePath = unixPath;
          }
          return Promise.resolve(JSON.stringify(request));
        },
      });
    });
}
