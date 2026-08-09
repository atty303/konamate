import $ from "@david/dax";
import * as path from "@std/path";
import * as pathWin from "@std/path/windows";

export type LaunchUrl = {
  raw: string;
  token: string;
};

export type LaunchTemplateContext = {
  url: string;
  token: string;
  installDir?: string;
  metadata: Record<string, unknown>;
};

const commandPlaceholderPattern = /^%u|^%t|^%r|^%\{(.*?)\}/;

type ShellQuote = "unquoted" | "single" | "double";

type ShellFrame = {
  quote: ShellQuote;
  escaped: boolean;
  closing?: ")" | "}" | "`";
  nesting: number;
};

export function parseLaunchUrl(raw: string, urlScheme: string): LaunchUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (cause) {
    throw new Error(`Invalid launch URL for ${urlScheme}`, { cause });
  }

  if (parsed.protocol !== `${urlScheme.toLowerCase()}:`) {
    throw new Error(
      `Unexpected URL scheme '${
        parsed.protocol.slice(0, -1)
      }'; expected '${urlScheme}'`,
    );
  }

  const token = parsed.searchParams.get("tk");
  if (!token) throw new Error("No token found in URL");

  return { raw, token };
}

export function needsInstallDir(command: string, cwd?: string): boolean {
  return command.includes("%r") || cwd?.includes("%r") === true;
}

export function expandLaunchCommand(
  template: string,
  context: LaunchTemplateContext,
): string {
  let result = "";
  const frames: ShellFrame[] = [{
    quote: "unquoted",
    escaped: false,
    nesting: 0,
  }];

  for (let index = 0; index < template.length;) {
    const frame = frames.at(-1)!;
    const rest = template.slice(index);
    const match = commandPlaceholderPattern.exec(rest);
    if (match) {
      if (
        frame.escaped ||
        (frame.quote === "single" && template[index - 1] === "\\")
      ) {
        throw new Error(`Launch placeholder cannot be escaped: ${match[0]}`);
      }
      if (frames.length > 1) {
        throw new Error(
          `Launch placeholder cannot be used inside a shell expansion: ${
            match[0]
          }`,
        );
      }
      result += escapeForShellQuote(
        placeholderValue(match[0], match[1], context),
        frame.quote,
      );
      index += match[0].length;
      continue;
    }

    const character = template[index];
    const next = template[index + 1];

    if (frame.escaped) {
      frame.escaped = false;
    } else if (character === "\\" && frame.quote !== "single") {
      frame.escaped = true;
    } else if (character === "'" && frame.quote !== "double") {
      frame.quote = frame.quote === "single" ? "unquoted" : "single";
    } else if (character === '"' && frame.quote !== "single") {
      frame.quote = frame.quote === "double" ? "unquoted" : "double";
    } else if (frame.quote !== "single") {
      const closing = character === "$" && next === "("
        ? ")" as const
        : character === "$" && next === "{"
        ? "}" as const
        : (character === "<" || character === ">") && next === "("
        ? ")" as const
        : undefined;
      if (closing !== undefined) {
        result += character + next;
        index += 2;
        frames.push({ quote: "unquoted", escaped: false, closing, nesting: 0 });
        continue;
      }
      if (character === "`") {
        result += character;
        index++;
        if (frame.closing === "`") frames.pop();
        else {
          frames.push({
            quote: "unquoted",
            escaped: false,
            closing: "`",
            nesting: 0,
          });
        }
        continue;
      }
      if (frame.quote === "unquoted" && frame.closing !== undefined) {
        const opening = frame.closing === ")" ? "(" : "{";
        if (character === opening) {
          frame.nesting++;
        } else if (character === frame.closing) {
          if (frame.nesting === 0) frames.pop();
          else frame.nesting--;
        }
      }
    }

    result += character;
    index++;
  }

  return result;
}

function placeholderValue(
  placeholder: string,
  metadataKey: string | undefined,
  context: LaunchTemplateContext,
): string {
  switch (placeholder) {
    case "%u":
      return context.url;
    case "%t":
      return context.token;
    case "%r":
      if (context.installDir === undefined) {
        throw new Error("Installation directory is required for %r");
      }
      return context.installDir;
    default: {
      const value = context.metadata[metadataKey ?? ""];
      return typeof value === "string" ? value : "";
    }
  }
}

function escapeForShellQuote(value: string, quote: ShellQuote): string {
  switch (quote) {
    case "unquoted":
      return $.escapeArg(value);
    case "single":
      return value.replaceAll("'", `'"'"'`);
    case "double":
      return value.replaceAll(/[$`"\\]/g, "\\$&");
  }
}

export function resolveProfileCwd(
  cwd: string | undefined,
  installDir: string | undefined,
  winePrefix: string,
): string | undefined {
  if (cwd === undefined) return undefined;
  if (!cwd.includes("%r")) return cwd;
  if (installDir === undefined) {
    throw new Error("Installation directory is required for cwd containing %r");
  }
  return winPathToUnix(cwd.replaceAll("%r", installDir), winePrefix);
}

export function winPathToUnix(pathInWin: string, winePrefix: string): string {
  const parsedPathWin = pathWin.parse(pathInWin);
  const drive = parsedPathWin.root[0].toLowerCase();
  const pathUnixInDrive = path.fromFileUrl(pathWin.toFileUrl(pathWin.format({
    dir: `\\${parsedPathWin.dir.replace(parsedPathWin.root, "")}`,
    base: parsedPathWin.base,
  })));

  return path.join(
    winePrefix,
    `drive_${drive}`,
    pathUnixInDrive,
  );
}
