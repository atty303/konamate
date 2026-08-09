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

export async function resolveBrowserExecutable(
  override?: string,
): Promise<string> {
  if (override) return override;
  try {
    return (await readSettings()).browser;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        "Browser is not configured. Run 'konamate config --browser <path>' first.",
        { cause: error },
      );
    }
    throw error;
  }
}

export const settingsCommand = new Command()
  .description("Manage application-wide configuration")
  .option(
    "--browser <path:file>",
    "Chromium executable used for authentication",
  )
  .action(async (options) => {
    const settings = options.browser === undefined
      ? await readSettings()
      : AppSettingsSchema.parse({ browser: options.browser });
    $.log(JSON.stringify(settings, null, 2));
    if (options.browser !== undefined) {
      await writeSettings(settings);
      $.logStep("Application configuration saved");
    }
  });
