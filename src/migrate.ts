import { Command } from "@cliffy/command";
import $ from "@david/dax";
import * as path from "@std/path";
import { z } from "zod";
import { configDir, legacyConfigDir, legacyStateDir, stateDir } from "./app.ts";
import {
  legacyGameConfigPath,
  parseConfigToml,
  readConfigFile,
  writeConfigFile,
} from "./config_file.ts";
import { defaultGames } from "./games.ts";
import {
  AppSettingsSchema,
  GameConfigSchema,
  GameDefinitionSchema,
  type KonamateConfig,
  KonamateConfigSchema,
} from "./models.ts";
import { RegistryDeclarationsSchema } from "./registry_declaration.ts";

export type MigrationReport = {
  copied: string[];
  conflicts: string[];
};

async function stat(filePath: string): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.lstat(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function requireRegularFile(filePath: string, info: Deno.FileInfo): void {
  if (info.isSymlink || !info.isFile) {
    throw new Error(`Migration input must be a regular file: ${filePath}`);
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
    await Deno.mkdir(path.dirname(destination), { recursive: true });
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

export async function preflightUnifiedDirectoryMigration(
  source: string,
  destination: string,
): Promise<void> {
  const temporary = await Deno.makeTempDir();
  try {
    const report: MigrationReport = { copied: [], conflicts: [] };
    const baseNames = [
      "config.toml",
      "config.json",
      "config.pre-unified-toml-migration.json",
      "games.json",
      "games.pre-unified-toml-migration.json",
    ];
    for (const name of baseNames) {
      await copyUnifiedMigrationFile(destination, temporary, name, report);
      await copyUnifiedMigrationFile(source, temporary, name, report);
    }
    const stagedConfig = await readConfigFile(
      path.join(temporary, "config.toml"),
    );
    const stagedGames = await readMigrationSource(
      path.join(temporary, "games.json"),
      LegacyGamesSchema,
    );
    const gameIds = new Set([
      ...defaultGames.map((game) => game.id),
      ...(stagedGames?.value.map((game) => game.id) ?? []),
      ...Object.keys(stagedConfig.games),
      ...Object.keys(stagedConfig.profiles),
    ]);
    for (const gameId of gameIds) {
      const gameFile = path.basename(legacyGameConfigPath(temporary, gameId));
      const backupFile = path.basename(
        backupPath(path.join(temporary, gameFile)),
      );
      for (const name of [gameFile, backupFile]) {
        await copyUnifiedMigrationFile(destination, temporary, name, report);
        await copyUnifiedMigrationFile(source, temporary, name, report);
      }
    }
    await migrateUnifiedConfig(temporary);
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}

async function copyUnifiedMigrationFile(
  sourceDirectory: string,
  destinationDirectory: string,
  name: string,
  report: MigrationReport,
): Promise<void> {
  const source = path.join(sourceDirectory, name);
  const info = await stat(source);
  if (!info) return;
  requireRegularFile(source, info);
  await copyMissing(source, path.join(destinationDirectory, name), report);
}

const LegacyProfileSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
}).strict();
const LegacyGameConfigSchema = z.object({
  env: z.record(z.string(), z.string()),
  profiles: z.record(z.string().min(1), LegacyProfileSchema),
  registry: RegistryDeclarationsSchema.optional(),
  runProfile: z.string().min(1).nullable().optional(),
}).strict();
const LegacyGameDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameLocalized: z.record(z.string(), z.string()).optional(),
  urlScheme: z.string().min(1),
  loginUrl: z.url(),
  registryKey: z.string().min(1),
  registry: RegistryDeclarationsSchema.optional(),
  profiles: z.record(z.string().min(1), LegacyProfileSchema),
  runProfile: z.string().min(1),
}).catchall(z.string());
const LegacyGamesSchema = z.array(LegacyGameDefinitionSchema).superRefine(
  (games, context) => {
    const seen = new Set<string>();
    for (const [index, game] of games.entries()) {
      if (seen.has(game.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Duplicate game ID '${game.id}'`,
        });
      }
      seen.add(game.id);
    }
  },
);

type SourceFile = {
  source: string;
  backup: string;
  text: string;
  sourceExists: boolean;
};

export type UnifiedMigrationReport = {
  migrated: string[];
  resumed: string[];
  skipped: string[];
};

function backupPath(source: string): string {
  const extension = path.extname(source);
  const base = source.slice(0, -extension.length);
  return `${base}.pre-unified-toml-migration${extension}`;
}

async function readJson<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<{ text: string; value: T } | undefined> {
  const info = await stat(filePath);
  if (!info) return undefined;
  requireRegularFile(filePath, info);
  const text = await Deno.readTextFile(filePath);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${String(error)}`, {
      cause: error,
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid data in ${filePath}:\n${z.prettifyError(parsed.error)}`,
      { cause: parsed.error },
    );
  }
  return { text, value: parsed.data };
}

async function readMigrationSource<T>(
  source: string,
  schema: z.ZodType<T>,
): Promise<({ text: string; value: T } & SourceFile) | undefined> {
  const backup = backupPath(source);
  const original = await readJson(source, schema);
  if (original) {
    const saved = await readJson(backup, schema);
    if (saved && stable(original.value) !== stable(saved.value)) {
      throw new Error(`Migration backup conflicts with source: ${backup}`);
    }
    return {
      ...original,
      source,
      backup,
      sourceExists: true,
    };
  }
  const loaded = await readJson(backup, schema);
  return loaded
    ? { ...loaded, source, backup, sourceExists: false }
    : undefined;
}

const migratedProfile = (profile: z.infer<typeof LegacyProfileSchema>) => ({
  ...profile,
  env: {},
  registry: [],
});

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
        .join(",")
    }}`;
  }
  return JSON.stringify(value);
}

async function ensureBackup(file: SourceFile): Promise<"migrated" | "resumed"> {
  const existing = await stat(file.backup);
  if (existing) {
    requireRegularFile(file.backup, existing);
    return "resumed";
  }
  await Deno.writeTextFile(file.backup, file.text, {
    createNew: true,
    mode: 0o600,
  });
  await Deno.chmod(file.backup, 0o600);
  return "migrated";
}

async function ensurePrivateFile(filePath: string): Promise<void> {
  await Deno.chmod(filePath, 0o600);
}

export function migrationDisplayName(filePath: string): string {
  return path.basename(filePath);
}

export async function migrateUnifiedConfig(
  directory = configDir(),
): Promise<UnifiedMigrationReport> {
  const settingsPath = path.join(directory, "config.json");
  const gamesPath = path.join(directory, "games.json");
  const target = path.join(directory, "config.toml");
  const targetInfo = await stat(target);
  if (targetInfo) requireRegularFile(target, targetInfo);
  const existingConfig = targetInfo
    ? parseConfigToml(await Deno.readTextFile(target), target)
    : undefined;
  const settings = await readMigrationSource(settingsPath, AppSettingsSchema);
  const games = await readMigrationSource(gamesPath, LegacyGamesSchema);
  const gameIds = new Set([
    ...defaultGames.map((game) => game.id),
    ...(games?.value.map((game) => game.id) ?? []),
    ...Object.keys(existingConfig?.games ?? {}),
    ...Object.keys(existingConfig?.profiles ?? {}),
  ]);
  const profileFiles = await Promise.all(
    [...gameIds].map(async (id) => ({
      id,
      loaded: await readMigrationSource(
        legacyGameConfigPath(directory, id),
        LegacyGameConfigSchema,
      ),
    })),
  );
  const sources: SourceFile[] = [];
  if (settings) {
    sources.push(settings);
  }
  if (games) {
    sources.push(games);
  }
  for (const { loaded } of profileFiles) {
    if (loaded) {
      sources.push(loaded);
    }
  }
  if (sources.length === 0) {
    if (targetInfo) await ensurePrivateFile(target);
    return {
      migrated: [],
      resumed: [],
      skipped: targetInfo ? [target] : [],
    };
  }
  const convertedGames = Object.fromEntries((games?.value ?? []).map((game) => {
    const {
      registry = [],
      profiles,
      ...rest
    } = game;
    const convertedGame = GameDefinitionSchema.parse({
      ...rest,
      common: { env: {}, registry },
      profiles: Object.fromEntries(
        Object.entries(profiles).map(([name, profile]) => [
          name,
          migratedProfile(profile),
        ]),
      ),
    });
    return [convertedGame.id, convertedGame];
  }));
  const definitions = new Map(
    [...defaultGames, ...Object.values(convertedGames)].map((game) => [
      game.id,
      game,
    ]),
  );
  const converted: KonamateConfig = KonamateConfigSchema.parse({
    settings: settings?.value ?? {},
    games: convertedGames,
    profiles: Object.fromEntries(profileFiles.flatMap(({ id, loaded }) => {
      if (!loaded) return [];
      const game = definitions.get(id);
      const runProfile = loaded.value.runProfile === undefined
        ? game?.runProfile ?? Object.keys(loaded.value.profiles)[0] ?? null
        : loaded.value.runProfile;
      return [[
        id,
        GameConfigSchema.parse({
          common: {
            env: loaded.value.env,
            registry: loaded.value.registry ?? [],
          },
          profiles: Object.fromEntries(
            Object.entries(loaded.value.profiles).map(([name, profile]) => [
              name,
              migratedProfile(profile),
            ]),
          ),
          runProfile,
        }),
      ]];
    })),
  });

  if (targetInfo) {
    if (stable(existingConfig) !== stable(converted)) {
      throw new Error(
        `Existing config.toml differs from the JSON migration result: ${target}`,
      );
    }
  }
  for (const source of sources) {
    const backup = await stat(source.backup);
    if (backup) requireRegularFile(source.backup, backup);
  }
  if (targetInfo && sources.every((source) => !source.sourceExists)) {
    await Promise.all([
      ensurePrivateFile(target),
      ...sources.map((source) => ensurePrivateFile(source.backup)),
    ]);
    return { migrated: [], resumed: [], skipped: [target] };
  }

  const migrated: string[] = [];
  const resumed: string[] = [];
  for (const source of sources) {
    (await ensureBackup(source) === "migrated" ? migrated : resumed).push(
      source.source,
    );
  }
  if (!targetInfo) await writeConfigFile(converted, target);
  await Promise.all([
    ensurePrivateFile(target),
    ...sources.map((source) => ensurePrivateFile(source.backup)),
  ]);
  const readback = await readConfigFile(target);
  if (stable(readback) !== stable(converted)) {
    throw new Error(`Unified configuration readback failed: ${target}`);
  }
  for (const source of sources) {
    if (source.sourceExists) await Deno.remove(source.source);
  }
  return { migrated, resumed, skipped: targetInfo ? [target] : [] };
}

export const migrateCommand = new Command()
  .description("Migrate legacy data and JSON configuration to config.toml")
  .action(async () => {
    await preflightUnifiedDirectoryMigration(legacyConfigDir(), configDir());
    const legacy = await migrateApplicationData();
    const unified = await migrateUnifiedConfig();
    $.logStep(
      `Migration complete: ${unified.migrated.length} migrated, ${unified.resumed.length} resumed, ${unified.skipped.length} skipped`,
    );
    for (const file of unified.migrated) {
      $.logLight(`Migrated: ${migrationDisplayName(file)}`);
    }
    for (const file of unified.resumed) {
      $.logLight(`Resumed: ${migrationDisplayName(file)}`);
    }
    for (const file of unified.skipped) {
      $.logLight(`Skipped: ${migrationDisplayName(file)}`);
    }
    for (const file of legacy.copied) {
      $.logLight(`Copied: ${migrationDisplayName(file)}`);
    }
    for (const file of legacy.conflicts) {
      $.logWarn(`Kept existing destination: ${migrationDisplayName(file)}`);
    }
  });
