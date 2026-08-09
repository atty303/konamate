import {
  expandLaunchCommand,
  needsInstallDir,
  parseLaunchUrl,
  resolveProfileCwd,
} from "../src/launch.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(action: () => unknown, pattern: RegExp): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error, "non-Error value was thrown");
    assert(pattern.test(error.message), `unexpected error: ${error.message}`);
    return;
  }
  throw new Error("expected an error");
}

Deno.test("validates and parses launch URLs", () => {
  const raw = "konaste.test://launch?tk=secret%20token";
  const parsed = parseLaunchUrl(raw, "konaste.test");
  assert(parsed.raw === raw, "raw URL was changed");
  assert(parsed.token === "secret token", "token was not decoded");

  assertThrows(
    () => parseLaunchUrl("not a URL", "konaste.test"),
    /Invalid launch URL/,
  );
  assertThrows(
    () => parseLaunchUrl("other.test://launch?tk=secret", "konaste.test"),
    /Unexpected URL scheme/,
  );
  assertThrows(
    () => parseLaunchUrl("konaste.test://launch", "konaste.test"),
    /No token found/,
  );
});

Deno.test("expands every command placeholder without recursive expansion", () => {
  const command = expandLaunchCommand(
    "run %u %u --token=%t %t %r %{id} %{missing}",
    {
      url: "konaste.test://launch?tk=%25t",
      token: "a'b;$(bad)%u",
      installDir: String.raw`C:\Program Files`,
      metadata: { id: "game id" },
    },
  );

  assert(
    command ===
      String
        .raw`run 'konaste.test://launch?tk=%25t' 'konaste.test://launch?tk=%25t' --token='a'"'"'b;$(bad)%u' 'a'"'"'b;$(bad)%u' 'C:\Program Files' 'game id' ''`,
    `unexpected command: ${command}`,
  );
});

Deno.test("shell-escapes placeholders in every quoting context", () => {
  const context = {
    url: "konaste.test://launch?tk=secret",
    token: "a'b\"c\\d$e$(bad)`bad`",
    metadata: {},
  };
  const quotedWithSingleQuotes = "printf 'a'\"'\"'b\"c\\d$e$(bad)`bad`'";

  assert(
    expandLaunchCommand("printf %t", context) === quotedWithSingleQuotes,
    "unquoted placeholder was not escaped",
  );
  assert(
    expandLaunchCommand("printf '%t'", context) === quotedWithSingleQuotes,
    "single-quoted placeholder was not escaped",
  );
  assert(
    expandLaunchCommand('printf "%t"', context) ===
      'printf "a\'b\\"c\\\\d\\$e\\$(bad)\\`bad\\`"',
    "double-quoted placeholder was not escaped",
  );
  assertThrows(
    () => expandLaunchCommand("printf \\%t", context),
    /placeholder cannot be escaped/,
  );
  assertThrows(
    () => expandLaunchCommand("printf '\\%t'", context),
    /placeholder cannot be escaped/,
  );
  for (
    const template of [
      'printf "$(printf %t)"',
      'printf "${value:-%t}"',
      "printf `<%t>`",
      "printf <(printf %t)",
    ]
  ) {
    assertThrows(
      () => expandLaunchCommand(template, context),
      /placeholder cannot be used inside a shell expansion/,
    );
  }
});

Deno.test("requires the installation directory only for profiles using it", () => {
  assert(!needsInstallDir("run %u"), "plain command required registry");
  assert(needsInstallDir("run %r\\game.exe"), "command placeholder missed");
  assert(
    needsInstallDir("run", "%r\\game"),
    "working directory placeholder missed",
  );
  assertThrows(
    () =>
      expandLaunchCommand("run %r", {
        url: "konaste.test://launch?tk=secret",
        token: "secret",
        metadata: {},
      }),
    /Installation directory is required/,
  );
});

Deno.test("resolves profile working directories", () => {
  assert(
    resolveProfileCwd("/tmp/game", undefined, "/prefix") === "/tmp/game",
    "Unix working directory was changed",
  );
  assert(
    resolveProfileCwd(
      String.raw`%r\game\modules`,
      String.raw`C:\Games`,
      "/prefix",
    ) === "/prefix/drive_c/Games/game/modules",
    "Wine working directory was not converted",
  );
  assertThrows(
    () => resolveProfileCwd("%r\\game", undefined, "/prefix"),
    /Installation directory is required/,
  );
});
