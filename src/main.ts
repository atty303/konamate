import { colors } from "@cliffy/ansi/colors";
import { Command, ValidationError } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { UpgradeCommand } from "@cliffy/command/upgrade";
import { GithubProvider } from "@cliffy/command/upgrade/provider/github";
import { defaultGames, GameDefinition } from "./games.ts";
import { gameCommand } from "./command.ts";
import { configDir } from "./config.ts";
import $ from "@david/dax";
import * as path from "@std/path";
import versionJson from "../version.json" with { type: "json" };
import { browserCommand } from "./browser.ts";
import { controllerCommand } from "./controller.ts";
import { secretCommand } from "./secret.ts";

const games = [...defaultGames];

// Load user-defined games from config
try {
  const userGames = await $.path(path.join(configDir, "games.json"))
    .readJson() as GameDefinition[];
  for (const game of userGames) {
    const existingGame = games.findIndex((g) => g.id === game.id);
    if (existingGame === -1) {
      games.push(game);
    } else {
      games[existingGame] = game;
    }
  }
} catch (_err) {
  // Ignore if the user games file does not exist
}

const cmd = new Command()
  .name("konaste")
  .version(versionJson)
  .usage("<game> <command> [options]")
  .description("Manage Konaste games")
  .meta("deno", Deno.version.deno)
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
  .command("ls", "List available games")
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
  .command("browser", browserCommand)
  .command("controller", controllerCommand)
  .command("secret", secretCommand);

games.forEach((game) => {
  cmd.command(game.id, gameCommand(game));
});
await cmd.parse();
