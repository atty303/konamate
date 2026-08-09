import {
  AppSettingsSchema,
  readSettings,
  resolveBrowserExecutable,
  writeSettings,
} from "../src/settings.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("persists and validates application settings", async () => {
  const directory = await Deno.makeTempDir();
  const file = `${directory}/config.json`;
  try {
    await writeSettings({ browser: "/usr/bin/chromium" }, file);
    assert(
      (await readSettings(file)).browser === "/usr/bin/chromium",
      "browser setting was not preserved",
    );

    await Deno.writeTextFile(file, JSON.stringify({ browser: "", extra: 1 }));
    let rejected = false;
    try {
      await readSettings(file);
    } catch {
      rejected = true;
    }
    assert(rejected, "invalid settings were accepted");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("browser override does not require stored settings", async () => {
  assert(
    await resolveBrowserExecutable("/temporary/browser") ===
      "/temporary/browser",
    "browser override was not preferred",
  );
  assert(
    !AppSettingsSchema.safeParse({ browser: "" }).success,
    "empty browser path was accepted",
  );
});
