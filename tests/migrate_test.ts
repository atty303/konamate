import * as path from "@std/path";
import { migrateDirectory } from "../src/migrate.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertRejects(
  action: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error, "non-Error value was thrown");
    assert(pattern.test(error.message), `unexpected error: ${error.message}`);
    return;
  }
  throw new Error("expected an error");
}

Deno.test("migration copies missing data and preserves conflicts", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = path.join(root, "legacy");
    const destination = path.join(root, "current");
    await Deno.mkdir(path.join(source, "nested"), { recursive: true });
    await Deno.mkdir(destination, { recursive: true });
    await Deno.writeTextFile(path.join(source, "new.json"), "legacy-new");
    await Deno.writeTextFile(path.join(source, "conflict.json"), "legacy");
    await Deno.writeTextFile(
      path.join(source, "nested", "state.json"),
      "state",
    );
    await Deno.writeTextFile(
      path.join(destination, "conflict.json"),
      "current",
    );

    const report = await migrateDirectory(source, destination);
    assert(report.copied.length === 2, "missing files were not copied");
    assert(report.conflicts.length === 1, "conflict was not reported");
    assert(
      await Deno.readTextFile(path.join(destination, "conflict.json")) ===
        "current",
      "existing destination was overwritten",
    );
    assert(
      await Deno.readTextFile(
        path.join(destination, "nested", "state.json"),
      ) ===
        "state",
      "nested file was not copied",
    );

    const repeated = await migrateDirectory(source, destination);
    assert(repeated.copied.length === 0, "migration was not idempotent");
    assert(repeated.conflicts.length === 3, "existing files were not reported");
    assert(
      await Deno.readTextFile(path.join(source, "new.json")) === "legacy-new",
      "legacy source was modified",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration ignores a missing source", async () => {
  const root = await Deno.makeTempDir();
  try {
    const report = await migrateDirectory(
      path.join(root, "missing"),
      path.join(root, "current"),
    );
    assert(report.copied.length === 0, "missing source copied data");
    assert(report.conflicts.length === 0, "missing source reported conflicts");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("migration rejects symbolic links before copying", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = path.join(root, "legacy");
    const destination = path.join(root, "current");
    await Deno.mkdir(source);
    await Deno.writeTextFile(path.join(source, "regular.json"), "data");
    await Deno.symlink("regular.json", path.join(source, "linked.json"));

    await assertRejects(
      () => migrateDirectory(source, destination),
      /Cannot migrate symbolic link.*linked\.json/,
    );
    try {
      await Deno.stat(destination);
      throw new Error("migration copied data before rejecting the link");
    } catch (error) {
      assert(
        error instanceof Deno.errors.NotFound,
        error instanceof Error ? error.message : String(error),
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
