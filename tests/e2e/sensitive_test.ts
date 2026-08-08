import { extractSdvxSchemeUrl, redactSensitive } from "./sensitive.ts";

Deno.test("extracts the last SDVX scheme URL", () => {
  const expected = "konaste.sdvx://launch?tk=secret-token";
  const actual = extractSdvxSchemeUrl(
    `Observed konaste.sdvx://stale?tk=old\n${expected}\n`,
  );
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
});

Deno.test("redacts scheme URLs and standalone authorization tokens", () => {
  const redacted = redactSensitive(
    "konaste.sdvx://launch?tk=secret-token https://example.test/?tk=other-secret&ok=1",
  );
  if (redacted.includes("secret")) {
    throw new Error(`Sensitive value was not redacted: ${redacted}`);
  }
  if (
    redacted !==
      "konaste.sdvx://<redacted> https://example.test/?tk=<redacted>&ok=1"
  ) {
    throw new Error(`Unexpected redacted output: ${redacted}`);
  }
});
