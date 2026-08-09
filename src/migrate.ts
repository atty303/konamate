import { Command } from "@cliffy/command";
import $ from "@david/dax";
import * as path from "@std/path";
import { configDir, legacyConfigDir, legacyStateDir, stateDir } from "./app.ts";

export type MigrationReport = {
  copied: string[];
  conflicts: string[];
};

async function stat(path: string): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function validateSourceTree(source: string): Promise<boolean> {
  const sourceInfo = await stat(source);
  if (!sourceInfo) return false;
  if (sourceInfo.isSymlink) {
    throw new Error(`Cannot migrate symbolic link: ${source}`);
  }
  if (sourceInfo.isDirectory) {
    for await (const entry of Deno.readDir(source)) {
      await validateSourceTree(path.join(source, entry.name));
    }
  }
  return true;
}

async function copyMissing(
  source: string,
  destination: string,
  report: MigrationReport,
): Promise<void> {
  const sourceInfo = await Deno.lstat(source);
  const destinationInfo = await stat(destination);

  if (destinationInfo) {
    if (sourceInfo.isDirectory && destinationInfo.isDirectory) {
      for await (const entry of Deno.readDir(source)) {
        await copyMissing(
          path.join(source, entry.name),
          path.join(destination, entry.name),
          report,
        );
      }
    } else {
      report.conflicts.push(destination);
    }
    return;
  }

  if (sourceInfo.isDirectory) {
    await Deno.mkdir(destination, { recursive: true });
    for await (const entry of Deno.readDir(source)) {
      await copyMissing(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        report,
      );
    }
  } else {
    await Deno.mkdir(path.dirname(destination), {
      recursive: true,
    });
    await Deno.copyFile(source, destination);
    report.copied.push(destination);
  }
}

export async function migrateDirectory(
  source: string,
  destination: string,
): Promise<MigrationReport> {
  const report: MigrationReport = { copied: [], conflicts: [] };
  if (!await validateSourceTree(source)) return report;
  await copyMissing(source, destination, report);
  return report;
}

export async function migrateApplicationData(): Promise<MigrationReport> {
  const migrations = [
    [legacyConfigDir(), configDir()],
    [legacyStateDir(), stateDir()],
  ] as const;
  for (const [source] of migrations) await validateSourceTree(source);

  const reports = await Promise.all(
    migrations.map(async ([source, destination]) => {
      const report: MigrationReport = { copied: [], conflicts: [] };
      if (await stat(source)) await copyMissing(source, destination, report);
      return report;
    }),
  );
  return {
    copied: reports.flatMap((report) => report.copied),
    conflicts: reports.flatMap((report) => report.conflicts),
  };
}

export const migrateCommand = new Command()
  .description("Migrate data from legacy Konaste locations")
  .action(async () => {
    const report = await migrateApplicationData();
    $.logStep(`Migrated ${report.copied.length} item(s)`);
    for (const path of report.copied) $.logLight(`Copied: ${path}`);
    for (const path of report.conflicts) {
      $.logWarn(`Kept existing destination: ${path}`);
    }
    if (report.conflicts.length > 0) {
      $.logStep(`Kept ${report.conflicts.length} existing item(s)`);
    }
  });
