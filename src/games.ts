import { z } from "zod";
import { readJsonFile } from "./json.ts";

export const GameProfileSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
}).strict();

export type GameProfile = z.infer<typeof GameProfileSchema>;

export const ProfileNameSchema = z.string().min(1).refine(
  (name) => name !== "__proto__",
  { message: "Profile name '__proto__' is reserved" },
);

const GameDefinitionFields = {
  id: z.string().min(1),
  name: z.string().min(1),
  nameLocalized: z.record(z.string(), z.string()).optional(),
  urlScheme: z.string().min(1),
  loginUrl: z.url(),
  registryKey: z.string().min(1),
  profiles: z.record(ProfileNameSchema, GameProfileSchema),
  runProfile: ProfileNameSchema,
};

export const GameDefinitionSchema = z.object(GameDefinitionFields)
  .catchall(z.string())
  .superRefine((game, context) => {
    if (!Object.hasOwn(game.profiles, game.runProfile)) {
      context.addIssue({
        code: "custom",
        path: ["runProfile"],
        message: `Profile '${game.runProfile}' does not exist`,
      });
    }
  });

export const GameDefinitionsSchema = z.array(GameDefinitionSchema);
export type GameDefinition = z.infer<typeof GameDefinitionSchema>;

export const defaultGames = GameDefinitionsSchema.parse([
  {
    id: "infinitas",
    name: "beatmania IIDX INFINITAS",
    nameLocalized: { ja: "beatmania IIDX INFINITAS" },
    urlScheme: "bm2dxinf",
    loginUrl: "https://p.eagate.573.jp/game/infinitas/2/api/login/login.html",
    registryKey: "Software\\KONAMI\\beatmania IIDX INFINITAS",
    profiles: {
      launcher: {
        command: "umu-run %r\\launcher\\modules\\bm2dx_launcher.exe %u",
      },
      game: {
        command: "umu-run %r\\game\\app\\bm2dx.exe -t %t",
      },
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
    profiles: {
      launcher: {
        command: "umu-run %r\\launcher\\modules\\launcher.exe %u",
      },
      game: {
        command: "umu-run %r\\game\\modules\\sv6c.exe -t %t",
      },
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
    profiles: {
      launcher: {
        command: "umu-run %r\\launcher\\modules\\launcher.exe %u",
      },
      guitarfreaks: {
        command:
          "umu-run %r\\game\\modules\\gitadora.exe -display0 -fullscreen -fhd -t %t -gf",
        cwd: "%r\\game",
      },
      drummania: {
        command:
          "umu-run %r\\game\\modules\\gitadora.exe -display0 -fullscreen -fhd -t %t -dm",
        cwd: "%r\\game",
      },
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

export function readGameDefinitions(filePath: string) {
  return readJsonFile(filePath, GameDefinitionsSchema);
}
