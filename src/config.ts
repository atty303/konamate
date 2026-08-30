import * as path from "@std/path";
import {
  assertNoLegacyFiles,
  readConfigFile,
  updateConfigFile,
  withGameConfig,
} from "./config_file.ts";
import type { GameDefinition } from "./games.ts";
import {
  type GameConfig,
  GameConfigSchema,
  type GameProfile,
  ProfileNameSchema,
  type RegistryDeclaration,
} from "./models.ts";

export { GameConfigSchema };
export type { GameConfig, RegistryDeclaration };

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

export function createDefaultConfig(game: GameDefinition): GameConfig {
  return GameConfigSchema.parse({
    common: {
      env: {
        WINEPREFIX: path.join(
          Deno.env.get("HOME") ?? "",
          "Games",
          "konamate",
          game.id,
        ),
        GAMEID: `umu-${game.id}`,
        ...game.common.env,
      },
      registry: game.common.registry,
    },
    profiles: game.profiles,
    runProfile: game.runProfile,
  });
}

export async function tryReadConfig(
  game: GameDefinition,
): Promise<GameConfig | undefined> {
  await assertNoLegacyFiles(game.id);
  const profiles = (await readConfigFile()).profiles;
  return Object.hasOwn(profiles, game.id) ? profiles[game.id] : undefined;
}

export async function readConfig(game: GameDefinition): Promise<GameConfig> {
  return await tryReadConfig(game) ?? createDefaultConfig(game);
}

export async function updateConfig(
  game: GameDefinition,
  update: (config: GameConfig) => GameConfig,
): Promise<GameConfig> {
  await assertNoLegacyFiles(game.id);
  let updated: GameConfig | undefined;
  await updateConfigFile((root) => {
    const current = Object.hasOwn(root.profiles, game.id)
      ? root.profiles[game.id]
      : createDefaultConfig(game);
    updated = GameConfigSchema.parse(
      update(current),
    );
    return withGameConfig(root, game.id, updated);
  });
  return updated!;
}

const registryId = (entry: Pick<RegistryDeclaration, "key" | "name">) =>
  `${entry.key}\0${entry.name}`.toLocaleLowerCase();

function storedProfile(
  config: GameConfig,
  name: string,
): GameProfile | undefined {
  return Object.hasOwn(config.profiles, name)
    ? config.profiles[name]
    : undefined;
}

export function mergeRegistryDeclarations(
  common: RegistryDeclaration[],
  profile: RegistryDeclaration[],
): RegistryDeclaration[] {
  const overridden = new Set(profile.map(registryId));
  return [
    ...common.filter((entry) => !overridden.has(registryId(entry))),
    ...profile,
  ];
}

export type EffectiveProfile = Omit<GameProfile, "env" | "registry"> & {
  env: Record<string, string>;
  registry: RegistryDeclaration[];
};

export function resolveEffectiveProfile(
  config: GameConfig,
  name: string,
): EffectiveProfile {
  const profile = storedProfile(config, name);
  if (!profile) throw new Error(`Profile '${name}' does not exist`);
  const env = { ...config.common.env };
  for (const [key, value] of Object.entries(profile.env)) {
    if (value === "") delete env[key];
    else env[key] = value;
  }
  return {
    command: profile.command,
    ...(profile.cwd === undefined ? {} : { cwd: profile.cwd }),
    env,
    registry: mergeRegistryDeclarations(
      config.common.registry,
      profile.registry,
    ),
  };
}

export function resolveProcessEnvironment(
  config: GameConfig,
  name: string,
): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {
    ...resolveEffectiveProfile(config, name).env,
  };
  for (
    const [key, value] of Object.entries(storedProfile(config, name)?.env ?? {})
  ) {
    if (value === "") environment[key] = undefined;
  }
  return environment;
}

export function resolveTarget(
  config: GameConfig,
  name: string,
  effective = false,
): GameProfile | GameConfig["common"] | EffectiveProfile {
  if (name === "common") return config.common;
  const profile = storedProfile(config, name);
  if (!profile) throw new Error(`Profile '${name}' does not exist`);
  return effective ? resolveEffectiveProfile(config, name) : profile;
}

export type ProfileUpdate = {
  name: string;
  command?: string;
  cwd?: string;
  unsetCwd?: boolean;
  delete?: boolean;
};

export function updateProfile(
  config: GameConfig,
  update: ProfileUpdate,
): GameConfig {
  if (update.name === "common") {
    throw new Error("'common' is not a launch profile");
  }
  ProfileNameSchema.parse(update.name);
  const profiles = { ...config.profiles };
  const current = Object.hasOwn(profiles, update.name)
    ? profiles[update.name]
    : undefined;
  if (update.delete) {
    if (!current) throw new Error(`Profile '${update.name}' does not exist`);
    delete profiles[update.name];
  } else {
    const hasUpdate = update.command !== undefined ||
      update.cwd !== undefined ||
      update.unsetCwd;
    if (!hasUpdate) {
      throw new Error("Provide --command, --cwd, or --unset-cwd");
    }
    if (!current && !update.command) {
      throw new Error("--command is required when creating a profile");
    }
    const cwd = update.unsetCwd ? undefined : update.cwd ?? current?.cwd;
    profiles[update.name] = {
      command: update.command ?? current!.command,
      ...(cwd === undefined ? {} : { cwd }),
      env: current?.env ?? {},
      registry: current?.registry ?? [],
    };
  }
  let runProfile = config.runProfile;
  if (update.delete && update.name === runProfile) runProfile = null;
  return GameConfigSchema.parse({ ...config, profiles, runProfile });
}

export function setDefaultProfile(
  config: GameConfig,
  name: string | null,
): GameConfig {
  if (name === "common") {
    throw new Error("'common' cannot be the default profile");
  }
  if (name !== null && !Object.hasOwn(config.profiles, name)) {
    throw new Error(`Profile '${name}' does not exist`);
  }
  return GameConfigSchema.parse({ ...config, runProfile: name });
}

export function updateEnvironment(
  config: GameConfig,
  target: string,
  name: string,
  action: "set" | "unset" | "inherit",
  value?: string,
): GameConfig {
  if (target === "common") {
    if (action === "inherit") {
      throw new Error("common environment cannot inherit");
    }
    const env = { ...config.common.env };
    if (action === "unset" || value === "") delete env[name];
    else env[name] = value!;
    return GameConfigSchema.parse({
      ...config,
      common: { ...config.common, env },
    });
  }
  const profile = storedProfile(config, target);
  if (!profile) throw new Error(`Profile '${target}' does not exist`);
  const env = { ...profile.env };
  if (action === "inherit") delete env[name];
  else env[name] = action === "unset" ? "" : value!;
  return GameConfigSchema.parse({
    ...config,
    profiles: { ...config.profiles, [target]: { ...profile, env } },
  });
}

export function updateRegistry(
  config: GameConfig,
  target: string,
  declaration: RegistryDeclaration | undefined,
  remove?: Pick<RegistryDeclaration, "key" | "name">,
): GameConfig {
  if (target === "common" && remove) {
    throw new Error("common registry declarations cannot inherit");
  }
  const current = target === "common"
    ? config.common.registry
    : storedProfile(config, target)?.registry;
  if (!current) throw new Error(`Profile '${target}' does not exist`);
  const id = registryId(declaration ?? remove!);
  const registry = [
    ...current.filter((entry) => registryId(entry) !== id),
    ...(declaration ? [declaration] : []),
  ];
  if (target === "common") {
    return GameConfigSchema.parse({
      ...config,
      common: { ...config.common, registry },
    });
  }
  return GameConfigSchema.parse({
    ...config,
    profiles: {
      ...config.profiles,
      [target]: { ...storedProfile(config, target)!, registry },
    },
  });
}
