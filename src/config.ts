import * as path from "@std/path";
import xdg from "@404wolf/xdg-portable";
import $ from "@david/dax";
import { GameProfile } from "./games.ts";

export type GameConfig = {
  env: Record<string, string>;
  profiles: Record<string, GameProfile>;
  runProfile: string | undefined;
};

export const configDir = path.join(xdg.config(), "konaste");

function configPath(game: string) {
  return path.join(configDir, `${game}.json`);
}

export async function tryReadConfig(
  gameId: string,
): Promise<GameConfig | undefined> {
  try {
    return await readConfig(gameId);
  } catch (_err) {
    return undefined;
  }
}

export async function readConfig(gameId: string): Promise<GameConfig> {
  const path = $.path(configPath(gameId));
  if (!await path.exists()) {
    throw new Error(
      `Configuration not found. Please run '${gameId} configure' first.`,
    );
  }
  return await path.readJson();
}

export async function writeConfig(
  gameId: string,
  config: GameConfig,
): Promise<void> {
  const path = $.path(configPath(gameId));
  await path.parent()?.ensureDir();
  await path.writeJsonPretty(config);
}
