import * as path from "@std/path";
import { parse, stringify } from "@std/toml";
import { z } from "zod";
import { configDir } from "./app.ts";
import {
  emptyKonamateConfig,
  type GameConfig,
  type GameDefinition,
  type KonamateConfig,
  KonamateConfigSchema,
} from "./models.ts";

export function configFilePath(): string {
  return path.join(configDir(), "config.toml");
}

function legacyPath(name: string): string {
  return path.join(configDir(), name);
}

export function legacyGameConfigPath(
  directory: string,
  gameId: string,
): string {
  if (
    gameId === "." || gameId === ".." || gameId.includes("/") ||
    gameId.includes("\\") || gameId.includes("\0") || path.isAbsolute(gameId)
  ) {
    throw new Error(
      `Game ID cannot be used as a configuration filename: ${gameId}`,
    );
  }
  return path.join(directory, `${gameId}.json`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await Deno.stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

export async function assertNoLegacyFiles(
  gameIds: string | readonly string[] = [],
): Promise<void> {
  const candidates = new Set([
    legacyPath("config.json"),
    legacyPath("games.json"),
  ]);
  for (const gameId of typeof gameIds === "string" ? [gameIds] : gameIds) {
    candidates.add(legacyGameConfigPath(configDir(), gameId));
  }
  const found = [];
  for (const candidate of candidates) {
    if (await exists(candidate)) found.push(candidate);
  }
  if (found.length > 0) {
    throw new Error(
      `Legacy JSON configuration found: ${
        found.join(", ")
      }. Run 'konamate migrate' to create config.toml.`,
    );
  }
}

const diskProfileSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  registry: z.array(z.unknown()).optional(),
}).strict();

function fromDisk(raw: unknown): KonamateConfig {
  const root = z.object({
    settings: z.unknown().optional(),
    games: z.record(z.string(), z.unknown()).optional(),
    profiles: z.record(z.string(), z.unknown()).optional(),
  }).strict().parse(raw);

  const games = Object.fromEntries(
    Object.entries(root.games ?? {}).map(([id, value]) => {
      const game = z.object({
        name: z.unknown(),
        name_localized: z.unknown().optional(),
        url_scheme: z.unknown(),
        login_url: z.unknown(),
        registry_key: z.unknown(),
        common: z.unknown(),
        profiles: z.unknown(),
        run_profile: z.unknown(),
      }).catchall(z.unknown()).superRefine((game, context) => {
        for (
          const reserved of [
            "id",
            "nameLocalized",
            "urlScheme",
            "loginUrl",
            "registryKey",
            "runProfile",
          ]
        ) {
          if (Object.hasOwn(game, reserved)) {
            context.addIssue({
              code: "custom",
              path: [reserved],
              message: `Use the snake_case field instead of '${reserved}'`,
            });
          }
        }
      }).parse(value);
      const {
        name_localized,
        url_scheme,
        login_url,
        registry_key,
        run_profile,
        ...rest
      } = game;
      return [id, {
        ...rest,
        id,
        ...(name_localized === undefined
          ? {}
          : { nameLocalized: name_localized }),
        urlScheme: url_scheme,
        loginUrl: login_url,
        registryKey: registry_key,
        runProfile: run_profile,
        profiles: normalizeProfiles(game.profiles),
      }];
    }),
  );

  const profiles = Object.fromEntries(
    Object.entries(root.profiles ?? {}).map(([id, value]) => {
      const profile = z.object({
        common: z.unknown(),
        entries: z.record(z.string(), z.unknown()),
        run_profile: z.unknown().optional(),
      }).strict().parse(value);
      return [id, {
        common: profile.common,
        profiles: normalizeProfiles(profile.entries),
        runProfile: profile.run_profile ?? null,
      }];
    }),
  );

  return KonamateConfigSchema.parse({
    settings: root.settings ?? {},
    games,
    profiles,
  });
}

function normalizeProfiles(value: unknown): Record<string, unknown> {
  const profiles = z.record(z.string(), diskProfileSchema).parse(value);
  return Object.fromEntries(
    Object.entries(profiles).map(([name, profile]) => [
      name,
      {
        command: profile.command,
        ...(profile.cwd === undefined ? {} : { cwd: profile.cwd }),
        env: profile.env ?? {},
        registry: profile.registry ?? [],
      },
    ]),
  );
}

function toDisk(config: KonamateConfig): Record<string, unknown> {
  const parsed = KonamateConfigSchema.parse(config);
  return {
    settings: parsed.settings,
    games: Object.fromEntries(
      Object.entries(parsed.games).map(([id, game]) => {
        const {
          id: _id,
          nameLocalized,
          urlScheme,
          loginUrl,
          registryKey,
          runProfile,
          ...rest
        } = game;
        return [
          id,
          compact({
            ...rest,
            name_localized: nameLocalized,
            url_scheme: urlScheme,
            login_url: loginUrl,
            registry_key: registryKey,
            run_profile: runProfile,
          }),
        ];
      }),
    ),
    profiles: Object.fromEntries(
      Object.entries(parsed.profiles).map(([id, profile]) => [
        id,
        compact({
          run_profile: profile.runProfile ?? undefined,
          common: profile.common,
          entries: profile.profiles,
        }),
      ]),
    ),
  };
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

export function parseConfigToml(text: string, filePath = "config.toml") {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new Error(`Invalid TOML in ${filePath}: ${String(error)}`, {
      cause: error,
    });
  }
  try {
    return fromDisk(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid data in ${filePath}:\n${z.prettifyError(error)}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function stringifyConfigToml(config: KonamateConfig): string {
  return stringify(toDisk(config) as never);
}

export async function readConfigFile(
  filePath = configFilePath(),
): Promise<KonamateConfig> {
  try {
    return parseConfigToml(await Deno.readTextFile(filePath), filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return emptyKonamateConfig();
    throw error;
  }
}

export async function writeConfigFile(
  config: KonamateConfig,
  filePath = configFilePath(),
): Promise<void> {
  const validated = KonamateConfigSchema.parse(config);
  const body = stringifyConfigToml(validated);
  const parent = path.dirname(filePath);
  await Deno.mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = await Deno.makeTempFile({
    dir: parent,
    prefix: ".config.toml-",
  });
  try {
    await Deno.writeTextFile(temporary, body, { mode: 0o600 });
    await Deno.chmod(temporary, 0o600);
    const readback = parseConfigToml(
      await Deno.readTextFile(temporary),
      temporary,
    );
    KonamateConfigSchema.parse(readback);
    await Deno.rename(temporary, filePath);
  } catch (error) {
    try {
      await Deno.remove(temporary);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Deno.errors.NotFound)) {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to publish and clean up ${filePath}`,
        );
      }
    }
    throw error;
  }
}

export async function updateConfigFile(
  update: (config: KonamateConfig) => KonamateConfig,
  filePath = configFilePath(),
): Promise<KonamateConfig> {
  const config = await readConfigFile(filePath);
  const next = KonamateConfigSchema.parse(update(config));
  await writeConfigFile(next, filePath);
  return next;
}

export function withGameConfig(
  root: KonamateConfig,
  gameId: string,
  gameConfig: GameConfig,
): KonamateConfig {
  return {
    ...root,
    profiles: { ...root.profiles, [gameId]: gameConfig },
  };
}

export function withGameDefinition(
  root: KonamateConfig,
  definition: GameDefinition,
): KonamateConfig {
  return {
    ...root,
    games: { ...root.games, [definition.id]: definition },
  };
}
