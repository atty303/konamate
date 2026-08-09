import { z } from "zod";
import { readJsonFile } from "../src/json.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertRejects(
  action: () => Promise<unknown>,
  check: (error: unknown) => boolean,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(check(error), `unexpected error: ${String(error)}`);
    return;
  }
  throw new Error("expected an error");
}

Deno.test({
  name: "reports JSON syntax and schema paths",
  permissions: { read: true, write: true },
  fn: async () => {
    const directory = await Deno.makeTempDir();
    try {
      const filePath = `${directory}/config.json`;
      await Deno.writeTextFile(filePath, "{");
      await assertRejects(
        () => readJsonFile(filePath, z.object({ value: z.string() })),
        (error) =>
          error instanceof Error &&
          error.message.includes(`Invalid JSON in ${filePath}`),
      );

      await Deno.writeTextFile(filePath, JSON.stringify({ value: 1 }));
      await assertRejects(
        () => readJsonFile(filePath, z.object({ value: z.string() })),
        (error) =>
          error instanceof Error &&
          error.message.includes(`Invalid data in ${filePath}`) &&
          error.message.includes("value"),
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name: "preserves a missing-file error",
  permissions: { read: true },
  fn: async () => {
    await assertRejects(
      () => readJsonFile("/missing/konamate.json", z.unknown()),
      (error) => error instanceof Deno.errors.NotFound,
    );
  },
});
