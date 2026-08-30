import { Command } from "@cliffy/command";
import $ from "@david/dax";
import * as path from "@std/path";
import {
  assertNoLegacyFiles,
  configFilePath,
  readConfigFile,
  updateConfigFile,
} from "./config_file.ts";
import {
  type AppSettings,
  AppSettingsSchema,
  KonamateConfigSchema,
} from "./models.ts";
import { defaultGames } from "./games.ts";

export { AppSettingsSchema };
export type { AppSettings };

const browserExecutableNames = [
  "google-chrome-stable",
  "google-chrome",
  "com.google.Chrome",
  "chromium",
  "chromium-browser",
  "org.chromium.Chromium",
  "brave-browser",
  "brave-browser-stable",
  "com.brave.Browser",
  "microsoft-edge-stable",
  "microsoft-edge",
  "com.microsoft.Edge",
  "vivaldi-stable",
  "vivaldi",
  "com.vivaldi.Vivaldi",
] as const;

export interface BrowserSearchEnvironment {
  path?: string;
  home?: string;
  xdgDataHome?: string;
}

export interface BrowserResolutionOptions {
  settingsFile?: string;
  searchDirectories?: readonly string[];
}

export function settingsPath(): string {
  return configFilePath();
}

export async function readSettings(
  filePath?: string,
): Promise<AppSettings> {
  const target = filePath ?? settingsPath();
  const config = await readConfigFile(target);
  if (filePath === undefined) {
    await assertNoLegacyFiles([
      ...defaultGames.map((game) => game.id),
      ...Object.keys(config.games),
      ...Object.keys(config.profiles),
    ]);
  }
  return AppSettingsSchema.parse(config.settings);
}

export async function writeSettings(
  settings: AppSettings,
  filePath?: string,
): Promise<void> {
  const parsed = AppSettingsSchema.parse(settings);
  await updateConfigFile(
    (config) => KonamateConfigSchema.parse({ ...config, settings: parsed }),
    filePath ?? settingsPath(),
  );
}

export function browserSearchDirectories(
  environment: BrowserSearchEnvironment = {
    path: Deno.env.get("PATH"),
    home: Deno.env.get("HOME"),
    xdgDataHome: Deno.env.get("XDG_DATA_HOME"),
  },
): string[] {
  const directories = (environment.path ?? "")
    .split(path.DELIMITER)
    .filter((directory) => path.isAbsolute(directory));
  const dataHome = environment.xdgDataHome ??
    (environment.home
      ? path.join(environment.home, ".local", "share")
      : undefined);
  if (dataHome) {
    directories.push(path.join(dataHome, "flatpak", "exports", "bin"));
  }
  directories.push("/var/lib/flatpak/exports/bin");
  return [...new Set(directories)];
}

export async function detectBrowserExecutable(
  directories: readonly string[] = browserSearchDirectories(),
): Promise<string | undefined> {
  for (const executable of browserExecutableNames) {
    for (const directory of directories) {
      const candidate = path.join(directory, executable);
      try {
        const info = await Deno.stat(candidate);
        if (info.isFile && ((info.mode ?? 0) & 0o111) !== 0) return candidate;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }
}

export async function resolveBrowserExecutable(
  override?: string,
  options: BrowserResolutionOptions = {},
): Promise<string> {
  if (override) return override;
  const filePath = options.settingsFile;
  const settings = await readSettings(filePath);
  if (settings.browser) return settings.browser;
  const browser = await detectBrowserExecutable(options.searchDirectories);
  if (browser) {
    await writeSettings({ ...settings, browser }, filePath);
    return browser;
  }
  throw browserNotFoundError();
}

function browserNotFoundError(cause?: unknown): Error {
  return new Error(
    "No compatible Chromium browser was detected. Run 'konamate settings --browser <path>' to configure one.",
    { cause },
  );
}

export const settingsCommand = new Command()
  .description("Manage application-wide configuration")
  .option(
    "--browser <path:file>",
    "Chromium executable used for authentication",
  )
  .option("--detect", "Detect and save a compatible Chromium executable", {
    conflicts: ["browser"],
  })
  .action(async (options) => {
    const current = await readSettings();
    const settings = await (async (): Promise<AppSettings> => {
      if (options.browser !== undefined) {
        return AppSettingsSchema.parse({
          ...current,
          browser: options.browser,
        });
      }
      if (!options.detect) return current;
      const browser = await detectBrowserExecutable();
      if (!browser) throw browserNotFoundError();
      return { ...current, browser };
    })();
    $.log(JSON.stringify(settings, null, 2));
    if (options.browser !== undefined || options.detect) {
      await writeSettings(settings);
      $.logStep("Application configuration saved");
    }
  });
