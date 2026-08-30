import { assertNoLegacyFiles, readConfigFile } from "./config_file.ts";
import {
  type GameDefinition,
  GameDefinitionSchema,
  GameDefinitionsSchema,
  type GameProfile,
  GameProfileSchema,
  ProfileNameSchema,
} from "./models.ts";

const profile = (
  value: Omit<GameProfile, "env" | "registry">,
): GameProfile => ({ ...value, env: {}, registry: [] });

export {
  GameDefinitionSchema,
  GameDefinitionsSchema,
  GameProfileSchema,
  ProfileNameSchema,
};
export type { GameDefinition, GameProfile };

export const defaultGames = GameDefinitionsSchema.parse([
  {
    id: "infinitas",
    name: "beatmania IIDX INFINITAS",
    nameLocalized: { ja: "beatmania IIDX INFINITAS" },
    urlScheme: "bm2dxinf",
    loginUrl: "https://p.eagate.573.jp/game/infinitas/2/api/login/login.html",
    registryKey: "Software\\KONAMI\\beatmania IIDX INFINITAS",
    common: {
      env: {},
      registry: [
        {
          action: "set",
          key: "HKCU\\Software\\Wine\\Explorer",
          name: "Desktop",
          type: "string",
          value: "Default",
        },
        {
          action: "set",
          key: "HKCU\\Software\\Wine\\Explorer\\Desktops",
          name: "Default",
          type: "string",
          value: "1920x1080",
        },
        {
          action: "set",
          key: "HKCU\\Software\\Wine\\X11 Driver",
          name: "Decorated",
          type: "string",
          value: "N",
        },
        {
          action: "set",
          key: "HKCU\\Software\\Wine\\X11 Driver",
          name: "Managed",
          type: "string",
          value: "N",
        },
      ],
    },
    profiles: {
      launcher: profile({
        command: "umu-run %r\\launcher\\modules\\bm2dx_launcher.exe %u",
      }),
      game: profile({ command: "umu-run %r\\game\\app\\bm2dx.exe -t %t" }),
    },
    runProfile: "launcher",
  },
  {
    id: "sdvx",
    name: "SOUND VOLTEX EXCEED GEAR",
    nameLocalized: { ja: "SOUND VOLTEX EXCEED GEAR" },
    urlScheme: "konaste.sdvx",
    loginUrl:
      "http://eagate.573.jp/game/konasteapp/API/login/login.html?game_id=sdvx",
    registryKey: "Software\\KONAMI\\SOUND VOLTEX EXCEED GEAR",
    common: { env: {}, registry: [] },
    profiles: {
      launcher: profile({
        command: "umu-run %r\\launcher\\modules\\launcher.exe %u",
      }),
      game: profile({ command: "umu-run %r\\game\\modules\\sv6c.exe -t %t" }),
    },
    runProfile: "launcher",
  },
  {
    id: "gitadora",
    name: "GITADORA",
    nameLocalized: { ja: "GITADORA" },
    urlScheme: "konaste.gitadora",
    loginUrl:
      "http://eagate.573.jp/game/konasteapp/API/login/login.html?game_id=gitadora",
    registryKey: "Software\\KONAMI\\GITADORA",
    common: { env: {}, registry: [] },
    profiles: {
      launcher: profile({
        command: "umu-run %r\\launcher\\modules\\launcher.exe %u",
      }),
      guitarfreaks: profile({
        command:
          "umu-run %r\\game\\modules\\gitadora.exe -display0 -fullscreen -fhd -t %t -gf",
        cwd: "%r\\game",
      }),
      drummania: profile({
        command:
          "umu-run %r\\game\\modules\\gitadora.exe -display0 -fullscreen -fhd -t %t -dm",
        cwd: "%r\\game",
      }),
    },
    runProfile: "launcher",
  },
]);

export function mergeGameDefinitions(
  defaults: GameDefinition[],
  overrides: GameDefinition[],
): GameDefinition[] {
  const games = new Map(defaults.map((game) => [game.id, game]));
  for (const game of overrides) games.set(game.id, game);
  return [...games.values()];
}

export async function readGameDefinitions(): Promise<GameDefinition[]> {
  const config = await readConfigFile();
  await assertNoLegacyFiles([
    ...defaultGames.map((game) => game.id),
    ...Object.keys(config.games),
    ...Object.keys(config.profiles),
  ]);
  return Object.values(config.games);
}
