import * as path from "@std/path";
import * as pathWin from "@std/path/windows";
import xdg from "@404wolf/xdg-portable";
import { colors } from "@cliffy/ansi/colors";
import { Command } from "@cliffy/command";
import {
  GameConfig,
  readConfig,
  tryReadConfig,
  updateProfile,
  writeConfig,
} from "./config.ts";
import $ from "@david/dax";
import * as reg from "./winereg.ts";
import { readRegistryFile } from "./winereg.ts";
import { GameDefinition } from "./games.ts";
import { startProxy } from "./obs.ts";

function configCommand(def: GameDefinition) {
  return new Command()
    .description("Set configuration for the game")
    .option(
      "--env.* [value:string]",
      "Set environment variable (empty value to unset)",
    )
    .example("Show current configuration", "konaste game config")
    .example(
      "Set environment variables",
      "konaste game config --env WINEPREFIX=/path/to/prefix",
    )
    .action(async (options) => {
      const defaultConfig = {
        env: {
          WINEPREFIX: path.join(
            Deno.env.get("HOME") ?? "",
            "Games",
            "konaste",
            def.id,
          ),
          GAMEID: `umu-${def.id}`,
        },
        profiles: def.profiles,
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
        Deno.exit(0);
      }

      await writeConfig(def.id, config);
      $.logStep(`Configuration for ${def.id} saved`);
    });
}

function profileCommand(def: GameDefinition) {
  return new Command()
    .description(`Manage launch profiles for the game

command string supports the following placeholders:
  %u: URL passed to the game
  %t: Token from the URL
  %r: Installation directory as windows format (e.g. C:\\Games)
  %{id}: Game ID (e.g. 'infinitas', 'sdvx', etc.)
    `)
    .option("--default", "Set this profile as the default")
    .option(
      "--command <command:string>",
      `Set the launch command for the profile`,
    )
    .option("--cwd <dir:file>", "Set the working directory for the profile")
    .option("--delete", "Delete the profile")
    .arguments("[name:string]")
    .example("List all profiles", "konaste game profile")
    .example("Unset the default profile", "konaste game profile --default")
    .action(async (options, name) => {
      const current = await readConfig(def);
      const hasChanges = Object.keys(options).length > 0;
      const config = hasChanges
        ? updateProfile(current, {
          name,
          command: options.command,
          cwd: options.cwd,
          delete: options.delete,
          setDefault: options.default,
        })
        : current;

      $.log("Available profiles:");
      for (const [name, profile] of Object.entries(config.profiles)) {
        const isDefault = config.runProfile === name;
        $.log(
          `${
            isDefault
              ? colors.red.bold(`${name} (default)`)
              : colors.yellow(name)
          }: ${profile.command}`,
        );
      }
      if (!hasChanges) return;

      await writeConfig(def.id, config);
      $.logStep(`Configuration for ${def.id} saved`);
    });
}

function winPathToUnix(pathInWin: string, winePrefix: string): string {
  const parsedPathWin = pathWin.parse(pathInWin);
  const drive = parsedPathWin.root[0].toLowerCase();
  const pathUnixInDrive = path.fromFileUrl(pathWin.toFileUrl(pathWin.format({
    dir: `\\${parsedPathWin.dir.replace(parsedPathWin.root, "")}`,
    base: parsedPathWin.base,
  })));

  return path.join(
    winePrefix,
    `drive_${drive}`,
    pathUnixInDrive,
  );
}

async function extractIcon(
  def: GameDefinition,
  config: GameConfig,
  dest: string,
): Promise<void> {
  const systemReg = await readRegistryFile(
    path.join(config.env.WINEPREFIX, "system.reg"),
  );

  const [pathInWin, index] = await (() => {
    const iconValue = reg.findValue(
      systemReg,
      `Software\\Classes\\${def.urlScheme}\\DefaultIcon`,
      "",
    );
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

function associateCommand(def: GameDefinition) {
  return new Command()
    .description(`Associate the URL scheme "${def.urlScheme}://" with the game`)
    .option("--self-path <path:file>", "Path to the this executable")
    .action(async (options) => {
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
Exec=${selfPath} ${def.id} run %u
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

function execCommand(def: GameDefinition) {
  return new Command()
    .description("Run a command in same environment as the `run` subcommand")
    .arguments("<...command:string>")
    .action(async (_, ...command) => {
      const config = await readConfig(def);
      await $.raw`${command.join(" ")}`.env(config.env).printCommand();
    });
}

function runCommand(def: GameDefinition) {
  return new Command()
    .description(
      "Open the login page in a browser if url is not provided, otherwise run the game with the given URL",
    )
    .option("--no-notify", "Do not send a notification")
    .arguments("[url:string]")
    .action(async (options, url) => {
      if (!url) {
        await $`xdg-open ${def.loginUrl}`;
        return;
      }

      $.logStep(`Launching ${def.id} with URL: ${url}`);

      const config = await readConfig(def);

      // This command is expected to be run from a desktop entry, so notify the user
      if (options.notify) {
        await $`notify-send --app-name ${def.name} --urgency=low --icon=${def.id} --expire-time=5000 "Launching ${def.name}"`
          .noThrow();
      }

      const parsed = new URL(url);
      const token = parsed.searchParams.get("tk");
      if (!token) {
        throw new Error("No token found in URL");
      }

      const selectedProfileName = await (async () => {
        if (config.runProfile) {
          return config.runProfile;
        } else if (Object.keys(config.profiles).length === 1) {
          return Object.keys(config.profiles)[0];
        } else {
          const profileNames = Object.keys(config.profiles);
          if (profileNames.length === 0) {
            throw new Error("No profiles available for this game");
          } else if (options.notify) {
            const actions = profileNames.map((
              name,
            ) => ($.escapeArg(`--action=${name}=${name}`)));
            const selected =
              await $`notify-send --app-name ${def.name} --urgency=critical --icon=${def.id} ${
                $.rawArg(actions)
              } ${"Select a profile to run"}`.noThrow().text();
            $.logLight(`Selected profile: ${JSON.stringify(selected)}`);
            return profileNames.includes(selected) ? selected : undefined;
          } else {
            return undefined;
          }
        }
      })();
      if (!selectedProfileName) {
        throw new Error("No profile selected");
      }

      const profile = config.profiles[selectedProfileName];
      if (!profile) {
        throw new Error(
          `Run profile '${selectedProfileName}' not found for ${def.id}`,
        );
      }

      const systemReg = await readRegistryFile(
        path.join(config.env.WINEPREFIX, "system.reg"),
      );
      const installDir = reg.findValue(
        systemReg,
        def.registryKey,
        "InstallDir",
      );
      $.logLight(`Install directory: ${installDir?.data}`);

      const command = profile.command
        .replace("%u", $.escapeArg(url))
        .replace("%t", token)
        .replace("%r", (installDir?.data.toString() || "").replace(/ /g, "\\ "))
        .replace(
          /%\{(.*?)\}/g,
          (_, key: string) =>
            $.escapeArg(
              typeof def[key] === "string" ? def[key] : "",
            ),
        );

      let cwd = profile.cwd;
      if (profile.cwd) {
        if (profile.cwd.includes("%r")) {
          cwd = winPathToUnix(
            profile.cwd.replace("%r", installDir?.data.toString() || ""),
            config.env.WINEPREFIX,
          );
        }
      }

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

function obsWebSocketProxyCommand(def: GameDefinition) {
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
    .action(async (options) => {
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

export function gameCommand(def: GameDefinition) {
  return new Command()
    .description(`Commands for ${def.name}`)
    .command("config", configCommand(def))
    .command("profile", profileCommand(def))
    .command("associate", associateCommand(def))
    .command("exec", execCommand(def))
    .command("run", runCommand(def))
    .command("obs-websocket-proxy", obsWebSocketProxyCommand(def));
}
