import { Command } from "@cliffy/command";
import * as path from "@std/path";
import { extractSdvxSchemeUrl, redactSensitive } from "./sensitive.ts";

type Stage =
  | "preflight"
  | "confirmation"
  | "configuration"
  | "authentication"
  | "game"
  | "manual-verification"
  | "cleanup";

type StageResult = {
  stage: Stage;
  status: "passed" | "failed";
  detail?: string;
};

type E2eResult = {
  test: "sdvx-live-e2e";
  startedAt: string;
  finishedAt: string;
  status: "passed" | "failed" | "cancelled";
  versions: Record<string, string>;
  stages: StageResult[];
  manualVerification?: {
    titleScreen: boolean;
    audio: boolean;
    controller: boolean;
  };
};

class StageError extends Error {
  constructor(readonly stage: Stage, message: string) {
    super(message);
  }
}

type SupportedSignal = "SIGINT" | "SIGTERM";

class SignalError extends Error {
  constructor(readonly signal: SupportedSignal) {
    super(`Interrupted by ${signal}`);
  }
}

let activeChild: Deno.ChildProcess | undefined;
let cancelPrompt: (() => void) | undefined;
let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
let receivedSignal: SupportedSignal | undefined;

function killProcessGroup(child: Deno.ChildProcess, signal: Deno.Signal) {
  try {
    Deno.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process may have exited between the signal and this callback.
    }
  }
}

function receiveSignal(signal: SupportedSignal) {
  if (receivedSignal) return;
  receivedSignal = signal;
  cancelPrompt?.();
  const child = activeChild;
  if (child) {
    killProcessGroup(child, signal);
    forceKillTimer = setTimeout(() => {
      if (activeChild === child) killProcessGroup(child, "SIGKILL");
    }, 5000);
  }
}

const receiveSigint = () => receiveSignal("SIGINT");
const receiveSigterm = () => receiveSignal("SIGTERM");
Deno.addSignalListener("SIGINT", receiveSigint);
Deno.addSignalListener("SIGTERM", receiveSigterm);

function throwIfInterrupted() {
  if (receivedSignal) throw new SignalError(receivedSignal);
}

async function run(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<Deno.CommandOutput> {
  throwIfInterrupted();
  const child = new Deno.Command("setsid", {
    args: [command, ...args],
    env,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  activeChild = child;
  try {
    const output = await child.output();
    throwIfInterrupted();
    return output;
  } finally {
    if (activeChild === child) {
      activeChild = undefined;
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
        forceKillTimer = undefined;
      }
    }
  }
}

function outputText(output: Deno.CommandOutput): string {
  const decoder = new TextDecoder();
  return `${decoder.decode(output.stdout)}${decoder.decode(output.stderr)}`;
}

async function requireExecutable(executable: string): Promise<void> {
  if (executable.includes(path.SEPARATOR)) {
    try {
      const info = await Deno.stat(executable);
      if (info.isFile) return;
    } catch {
      // Report the common error below.
    }
    throw new Error(`Executable not found: ${executable}`);
  }

  for (const directory of (Deno.env.get("PATH") ?? "").split(path.DELIMITER)) {
    if (!directory) continue;
    try {
      const info = await Deno.stat(path.join(directory, executable));
      if (info.isFile) return;
    } catch {
      // Continue searching PATH.
    }
  }
  throw new Error(`Executable not found in PATH: ${executable}`);
}

async function readVersion(
  executable: string,
  args: string[],
): Promise<string> {
  try {
    const output = await run(executable, args);
    const text = redactSensitive(outputText(output)).trim();
    return text.split("\n")[0] || "unknown";
  } catch {
    throwIfInterrupted();
    return "unknown";
  }
}

async function confirm(message: string): Promise<boolean> {
  throwIfInterrupted();
  await Deno.stdout.write(new TextEncoder().encode(`${message} [y/N] `));
  const reader = Deno.stdin.readable.getReader();
  let raw = false;
  try {
    Deno.stdin.setRaw(true);
    raw = true;
    cancelPrompt = () => {
      reader.cancel().catch(() => {});
    };
    throwIfInterrupted();
    let response = "";
    while (true) {
      const { value, done } = await reader.read();
      throwIfInterrupted();
      if (done) return false;
      for (const byte of value) {
        if (byte === 3) {
          receiveSignal("SIGINT");
          throwIfInterrupted();
        }
        if (byte === 10 || byte === 13) {
          await Deno.stdout.write(new Uint8Array([10]));
          return response.trim().toLowerCase() === "y";
        }
        if (byte === 127) {
          if (response.length > 0) {
            response = response.slice(0, -1);
            await Deno.stdout.write(new TextEncoder().encode("\b \b"));
          }
        } else if (byte >= 32 && byte <= 126) {
          const character = String.fromCharCode(byte);
          response += character;
          await Deno.stdout.write(new TextEncoder().encode(character));
        }
      }
    }
  } finally {
    cancelPrompt = undefined;
    reader.releaseLock();
    if (raw) Deno.stdin.setRaw(false);
  }
}

function parseGameEnv(values: string[]): Record<string, string> {
  const protectedNames = new Set([
    "GAMEID",
    "PROTONPATH",
    "PULSE_SINK",
    "WINEPREFIX",
  ]);
  return Object.fromEntries(values.map((value) => {
    const separator = value.indexOf("=");
    if (separator < 1) {
      throw new Error(`Invalid --game-env value: ${value}`);
    }
    const name = value.slice(0, separator);
    if (protectedNames.has(name)) {
      throw new Error(`${name} must be set with its dedicated option`);
    }
    return [name, value.slice(separator + 1)];
  }));
}

async function writeResult(outputPath: string, result: E2eResult) {
  await Deno.mkdir(path.dirname(outputPath), { recursive: true });
  await Deno.writeTextFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

const defaultBrowser = "/var/lib/flatpak/exports/bin/com.google.Chrome";
const defaultBinary = "dist/konamate-x86_64-unknown-linux-gnu";

const { options } = await new Command()
  .name("sdvx-live-e2e")
  .description("Run the live SDVX launch flow against an existing Wine prefix")
  .option("--wine-prefix <path:file>", "Existing SDVX Wine prefix", {
    required: true,
  })
  .option("--proton-path <value:string>", "PROTONPATH value", {
    required: true,
  })
  .option("--browser <path:file>", "Browser executable", {
    default: defaultBrowser,
  })
  .option("--binary <path:file>", "Compiled konamate binary", {
    default: defaultBinary,
  })
  .option("--pulse-sink <name:string>", "PipeWire/PulseAudio sink", {
    default: "konamate-sink",
  })
  .option("--passkey-service <name:string>", "Existing passkey service", {
    default: "io.github.atty303.konamate",
  })
  .option("--passkey-name <name:string>", "Existing passkey name", {
    default: "passkey-default",
  })
  .option(
    "--game-env <name-value:string>",
    "Additional game environment variable as NAME=VALUE",
    { collect: true },
  )
  .option("--output <path:file>", "Result JSON path")
  .parse(Deno.args);

const startedAt = new Date();
const runId = startedAt.toISOString().replaceAll(":", "-");
const cacheHome = Deno.env.get("XDG_CACHE_HOME") ??
  path.join(Deno.env.get("HOME") ?? ".", ".cache");
const resultPath = options.output ??
  path.join(cacheHome, "konamate", "e2e", runId, "result.json");
const result: E2eResult = {
  test: "sdvx-live-e2e",
  startedAt: startedAt.toISOString(),
  finishedAt: startedAt.toISOString(),
  status: "failed",
  versions: {},
  stages: [],
};

let temporaryXdg: string | undefined;
let currentStage: Stage = "preflight";
let finalizationFailed = false;
try {
  try {
    if (!Deno.stdin.isTerminal()) {
      throw new Error("This live test requires an interactive TTY");
    }
    await requireExecutable(options.binary);
    await requireExecutable(options.browser);
    await requireExecutable("setsid");
    await requireExecutable("umu-run");
    await requireExecutable("wpctl");

    const prefixInfo = await Deno.stat(options.winePrefix);
    if (!prefixInfo.isDirectory) {
      throw new Error(`Wine prefix is not a directory: ${options.winePrefix}`);
    }
    await Deno.stat(path.join(options.winePrefix, "system.reg"));

    const sinkStatus = await run("wpctl", ["status", "--name"]);
    if (!sinkStatus.success) {
      throw new Error(redactSensitive(outputText(sinkStatus)).trim());
    }
    if (!outputText(sinkStatus).includes(options.pulseSink)) {
      throw new Error(`Audio sink not found: ${options.pulseSink}`);
    }

    parseGameEnv(options.gameEnv ?? []);
    result.versions.konamate = await readVersion(options.binary, ["-V"]);
    result.versions.umu = await readVersion("umu-run", ["--version"]);
    result.stages.push({ stage: "preflight", status: "passed" });
  } catch (error) {
    throw new StageError(
      "preflight",
      error instanceof Error ? error.message : String(error),
    );
  }

  currentStage = "confirmation";
  console.log(`This test will:
- authenticate to KONAMI with the existing keyring passkey
- launch SDVX using the existing Wine prefix: ${options.winePrefix}
- allow Proton and the game to update prefix state, caches, and game settings

It will not read ~/.config/konamate or reuse Playwright browser storage.`);
  if (!await confirm("Continue with the live test?")) {
    result.status = "cancelled";
    throw new StageError("confirmation", "Cancelled by user");
  }
  result.stages.push({ stage: "confirmation", status: "passed" });

  temporaryXdg = await Deno.makeTempDir({ prefix: "konamate-e2e-" });
  const isolatedEnv = {
    XDG_CONFIG_HOME: path.join(temporaryXdg, "config"),
    XDG_DATA_HOME: path.join(temporaryXdg, "data"),
    XDG_STATE_HOME: path.join(temporaryXdg, "state"),
  };

  currentStage = "configuration";
  const gameEnv = {
    ...parseGameEnv(options.gameEnv ?? []),
    WINEPREFIX: options.winePrefix,
    GAMEID: "umu-sdvx",
    PROTONPATH: options.protonPath,
    PULSE_SINK: options.pulseSink,
  };
  const configArgs = [
    "sdvx",
    "config",
    ...Object.entries(gameEnv).map(
      ([name, value]) => `--env.${name}=${value}`,
    ),
  ];
  const configured = await run(options.binary, configArgs, isolatedEnv);
  if (!configured.success) {
    throw new StageError(
      "configuration",
      redactSensitive(outputText(configured)).trim() ||
        "Failed to create configuration",
    );
  }
  const selectedProfile = await run(
    options.binary,
    ["sdvx", "profile", "game", "--default"],
    isolatedEnv,
  );
  if (!selectedProfile.success) {
    throw new StageError(
      "configuration",
      redactSensitive(outputText(selectedProfile)).trim() ||
        "Failed to select game profile",
    );
  }
  result.stages.push({ stage: "configuration", status: "passed" });

  currentStage = "authentication";
  console.log("Authenticating with the existing Playwright launch flow...");
  const authenticated = await run(options.binary, [
    "browser",
    "launch",
    "--browser",
    options.browser,
    "--url",
    "http://eagate.573.jp/game/konasteapp/API/login/login.html?game_id=sdvx",
    "--scheme",
    "konaste.sdvx",
    "--passkey-service",
    options.passkeyService,
    "--passkey-name",
    options.passkeyName,
  ], isolatedEnv);
  const authenticationOutput = outputText(authenticated);
  const schemeUrl = extractSdvxSchemeUrl(authenticationOutput);
  if (!authenticated.success || !schemeUrl) {
    throw new StageError(
      "authentication",
      redactSensitive(authenticationOutput).trim() ||
        "No SDVX scheme URL was returned",
    );
  }
  result.stages.push({ stage: "authentication", status: "passed" });

  currentStage = "game";
  console.log("Authentication succeeded. Launching SDVX...");
  const game = await run(
    options.binary,
    ["sdvx", "run", "--no-notify", schemeUrl],
    isolatedEnv,
  );
  const gameOutput = redactSensitive(outputText(game)).trim();
  if (gameOutput) console.log(gameOutput);
  if (!game.success) {
    throw new StageError("game", `SDVX exited with code ${game.code}`);
  }
  result.stages.push({ stage: "game", status: "passed" });

  currentStage = "manual-verification";
  result.manualVerification = {
    titleScreen: await confirm("Did the SDVX title screen render correctly?"),
    audio: await confirm("Did SDVX produce audio through the expected sink?"),
    controller: await confirm("Did the physical controller work in SDVX?"),
  };
  if (!Object.values(result.manualVerification).every(Boolean)) {
    throw new StageError(
      "manual-verification",
      "One or more manual checks failed",
    );
  }
  result.stages.push({ stage: "manual-verification", status: "passed" });
  result.status = "passed";
} catch (error) {
  const stageError = error instanceof StageError ? error : new StageError(
    currentStage,
    error instanceof Error ? error.message : String(error),
  );
  if (!result.stages.some(({ stage }) => stage === stageError.stage)) {
    result.stages.push({
      stage: stageError.stage,
      status: "failed",
      detail: redactSensitive(stageError.message),
    });
  }
  if (result.status !== "cancelled") result.status = "failed";
  console.error(
    `${stageError.stage}: ${redactSensitive(stageError.message)}`,
  );
} finally {
  result.finishedAt = new Date().toISOString();
  if (temporaryXdg) {
    try {
      await Deno.remove(temporaryXdg, { recursive: true });
    } catch (error) {
      finalizationFailed = true;
      result.status = "failed";
      result.stages.push({
        stage: "cleanup",
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    await writeResult(resultPath, result);
  } catch (error) {
    finalizationFailed = true;
    console.error(
      `result: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  Deno.removeSignalListener("SIGINT", receiveSigint);
  Deno.removeSignalListener("SIGTERM", receiveSigterm);
  console.log(`Result: ${resultPath}`);
}

if (receivedSignal === "SIGINT") Deno.exit(130);
if (receivedSignal === "SIGTERM") Deno.exit(143);
if (result.status !== "passed" || finalizationFailed) Deno.exit(1);
