import { Command } from "@cliffy/command";
import $ from "@david/dax";
import * as path from "@std/path";
import { z } from "zod";
import { configDir } from "./app.ts";
import { readJsonFile } from "./json.ts";

export const AppSettingsSchema = z.object({
  browser: z.string().min(1),
}).strict();

export type AppSettings = z.infer<typeof AppSettingsSchema>;

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
  return path.join(configDir(), "config.json");
}

export async function readSettings(
  filePath = settingsPath(),
): Promise<AppSettings> {
  return await readJsonFile(filePath, AppSettingsSchema);
}

export async function writeSettings(
  settings: AppSettings,
  filePath = settingsPath(),
): Promise<void> {
  const file = $.path(filePath);
  await file.parent()?.ensureDir();
  await file.writeJsonPretty(AppSettingsSchema.parse(settings));
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
  const filePath = options.settingsFile ?? settingsPath();
  try {
    return (await readSettings(filePath)).browser;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      const browser = await detectBrowserExecutable(options.searchDirectories);
      if (browser) {
        await writeSettings({ browser }, filePath);
        return browser;
      }
      throw browserNotFoundError(error);
    }
    throw error;
  }
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
    const shouldWrite = options.browser !== undefined || options.detect;
    const settings =
      await (async (): Promise<AppSettings | Record<never, never>> => {
        if (options.browser !== undefined) {
          return AppSettingsSchema.parse({ browser: options.browser });
        }
        if (!options.detect) {
          try {
            return await readSettings();
          } catch (error) {
            if (error instanceof Deno.errors.NotFound) return {};
            throw error;
          }
        }
        const browser = await detectBrowserExecutable();
        if (!browser) throw browserNotFoundError();
        return { browser };
      })();
    $.log(JSON.stringify(settings, null, 2));
    if (shouldWrite) {
      await writeSettings(AppSettingsSchema.parse(settings));
      $.logStep("Application configuration saved");
    }
  });
