import * as path from "@std/path";
import $ from "@david/dax";
import { z } from "zod";
import {
  GameDefinition,
  GameProfileSchema,
  ProfileNameSchema,
} from "./games.ts";
import { readJsonFile } from "./json.ts";
import { configDir } from "./app.ts";

const GameConfigFields = {
  env: z.record(z.string(), z.string()),
  profiles: z.record(ProfileNameSchema, GameProfileSchema),
};

export const GameConfigSchema = z.object({
  ...GameConfigFields,
  runProfile: ProfileNameSchema.nullable(),
}).strict().superRefine((config, context) => {
  if (
    typeof config.runProfile === "string" &&
    !Object.hasOwn(config.profiles, config.runProfile)
  ) {
    context.addIssue({
      code: "custom",
      path: ["runProfile"],
      message: `Profile '${config.runProfile}' does not exist`,
    });
  }
});

const StoredGameConfigSchema = z.object({
  ...GameConfigFields,
  runProfile: ProfileNameSchema.nullable().optional(),
}).strict().superRefine((config, context) => {
  if (
    typeof config.runProfile === "string" &&
    !Object.hasOwn(config.profiles, config.runProfile)
  ) {
    context.addIssue({
      code: "custom",
      path: ["runProfile"],
      message: `Profile '${config.runProfile}' does not exist`,
    });
  }
});

export type GameConfig = z.infer<typeof GameConfigSchema>;

export type ProfileSelector = (
  names: string[],
) => Promise<string | undefined>;

export async function resolveRunProfile(
  config: GameConfig,
  requested: string | undefined,
  select?: ProfileSelector,
): Promise<string> {
  if (requested !== undefined) {
    if (!Object.hasOwn(config.profiles, requested)) {
      throw new Error(`Profile '${requested}' does not exist`);
    }
    return requested;
  }
  if (config.runProfile) return config.runProfile;

  const names = Object.keys(config.profiles);
  if (names.length === 0) {
    throw new Error("No profiles available for this game");
  }
  if (names.length === 1) return names[0];

  const selected = await select?.(names);
  if (selected !== undefined && names.includes(selected)) return selected;
  throw new Error(
    `No profile selected. Choose one with --profile: ${names.join(", ")}`,
  );
}

export function configPath(game: string) {
  return path.join(configDir(), `${game}.json`);
}

export async function tryReadConfig(
  game: GameDefinition,
): Promise<GameConfig | undefined> {
  try {
    return await readStoredConfig(game);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

export async function readConfig(game: GameDefinition): Promise<GameConfig> {
  const filePath = configPath(game.id);
  try {
    return await readStoredConfig(game);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Configuration not found at ${filePath}. Please run 'konamate config ${game.id}' first.`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function readStoredConfig(game: GameDefinition): Promise<GameConfig> {
  const stored = await readJsonFile(
    configPath(game.id),
    StoredGameConfigSchema,
  );
  return normalizeConfig(stored, game);
}

export function normalizeConfig(
  stored: unknown,
  game: GameDefinition,
): GameConfig {
  const parsed = StoredGameConfigSchema.parse(stored);
  return GameConfigSchema.parse({
    ...parsed,
    runProfile: parsed.runProfile === undefined
      ? game.runProfile
      : parsed.runProfile,
  });
}

export async function writeConfig(
  gameId: string,
  config: GameConfig,
): Promise<void> {
  const path = $.path(configPath(gameId));
  await path.parent()?.ensureDir();
  await path.writeJsonPretty(GameConfigSchema.parse(config));
}

export type ProfileUpdate = {
  name?: string;
  command?: string;
  cwd?: string;
  delete?: boolean;
  setDefault?: boolean;
};

export function updateProfile(
  config: GameConfig,
  update: ProfileUpdate,
): GameConfig {
  const profiles = { ...config.profiles };
  const name = update.name === undefined
    ? undefined
    : ProfileNameSchema.parse(update.name);

  if (update.delete && update.command) {
    throw new Error("--delete and --command cannot be used together");
  }
  if ((update.delete || update.command || update.cwd) && !name) {
    throw new Error("A profile name is required");
  }
  if (update.cwd && !update.command) {
    throw new Error("--cwd requires --command");
  }

  if (update.delete && name) {
    if (!Object.hasOwn(profiles, name)) {
      throw new Error(`Profile '${name}' does not exist`);
    }
    delete profiles[name];
  } else if (update.command && name) {
    profiles[name] = { command: update.command, cwd: update.cwd };
  }

  let runProfile = config.runProfile;
  if (update.delete && name === runProfile) runProfile = null;
  if (update.setDefault) {
    if (name && !Object.hasOwn(profiles, name)) {
      throw new Error(`Profile '${name}' does not exist`);
    }
    runProfile = name ?? null;
  }

  return GameConfigSchema.parse({ ...config, profiles, runProfile });
}
