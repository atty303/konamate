import { redactSensitive } from "./sensitive.ts";

Deno.test("redacts scheme URLs and standalone authorization tokens", () => {
  const redacted = redactSensitive(
    "konaste.sdvx://launch?tk=secret-token https://example.test/?tk=other-secret&ok=1\n" +
      "> umu-run game.exe -t bare-secret\n" +
      `> umu-run game.exe -t 'quoted-secret'\n` +
      `> umu-run game.exe -t 'escaped'"'"'secret'`,
  );
  if (redacted.includes("secret")) {
    throw new Error(`Sensitive value was not redacted: ${redacted}`);
  }
  if (
    redacted !==
      "konaste.sdvx://<redacted> https://example.test/?tk=<redacted>&ok=1\n" +
        "> umu-run game.exe -t <redacted>\n" +
        "> umu-run game.exe -t <redacted>\n" +
        "> umu-run game.exe -t <redacted>"
  ) {
    throw new Error(`Unexpected redacted output: ${redacted}`);
  }
});
