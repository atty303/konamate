import { colors } from "@cliffy/ansi/colors";
import { Command, EnumType, ValidationError } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { UpgradeCommand } from "@cliffy/command/upgrade";
import { GithubProvider } from "@cliffy/command/upgrade/provider/github";
import {
  defaultGames,
  GameDefinition,
  mergeGameDefinitions,
  readGameDefinitions,
} from "./games.ts";
import {
  associateCommand,
  execCommand,
  obsWebSocketProxyCommand,
  profileCommand,
  runCommand,
} from "./command.ts";
import { APP_NAME } from "./app.ts";
import $ from "@david/dax";
import versionJson from "../version.json" with { type: "json" };
import { authCommand } from "./browser.ts";
import { controllerCommand } from "./controller.ts";
import { secretCommand } from "./secret.ts";
import { migrateCommand } from "./migrate.ts";
import { settingsCommand } from "./settings.ts";

async function main(): Promise<void> {
  const gameOperations = new Set([
    "games",
    "run",
    "profile",
    "associate",
    "exec",
    "obs-websocket-proxy",
    "completions",
  ]);
  const shouldLoadUserGames = gameOperations.has(Deno.args[0]);
  let userGames: GameDefinition[] = [];
  if (shouldLoadUserGames) {
    userGames = await readGameDefinitions();
  }
  const games = mergeGameDefinitions(defaultGames, userGames);
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const resolveGame = (id: string): GameDefinition => {
    const game = gamesById.get(id);
    if (!game) throw new Error(`Unknown game '${id}'`);
    return game;
  };

  const cmd = new Command()
    .name(APP_NAME)
    .version(versionJson)
    .usage("<command> [options]")
    .description("Manage Konaste games")
    .meta("deno", Deno.version.deno)
    .globalType("game", new EnumType(games.map((game) => game.id)))
    .command("completions", new CompletionsCommand())
    .command(
      "upgrade",
      new UpgradeCommand({
        provider: [
          new GithubProvider({ repository: "atty303/konamate" }),
        ],
      }).action(() => {
        // Upgrade command is not supported for single binary distribution
        throw new ValidationError(
          "This command is not supported yet. Please update manually.",
        );
      }),
    )
    .command("games", "List available games")
    .option("--json", "Output in JSON format")
    .action((options) => {
      if (options.json) {
        console.log(JSON.stringify(games, null, 2));
        Deno.exit(0);
      }
      for (const game of games) {
        $.log(
          `${colors.yellow.bold(game.id)} ${
            colors.gray(`(URL: ${game.urlScheme})`)
          }: ${game.name} - ${colors.blue.underline(game.loginUrl)}`,
        );
      }
    })
    .command("settings", settingsCommand)
    .command("migrate", migrateCommand)
    .command("auth", authCommand)
    .command("controller", controllerCommand)
    .command("secret", secretCommand)
    .command("profile", profileCommand(resolveGame))
    .command("associate", associateCommand(resolveGame))
    .command("exec", execCommand(resolveGame))
    .command("run", runCommand(resolveGame))
    .command(
      "obs-websocket-proxy",
      obsWebSocketProxyCommand(resolveGame),
    );
  await cmd.parse();
}

try {
  await main();
} catch (error) {
  if (Deno.args[0] === "controller" && Deno.args[1] === "pressed") {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(2);
  }
  throw error;
}
