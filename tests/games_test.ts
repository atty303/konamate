import { GameDefinitionSchema, mergeGameDefinitions } from "../src/games.ts";

const game = {
  id: "test",
  name: "Test Game",
  urlScheme: "test.game",
  loginUrl: "https://example.com/login",
  registryKey: "Software\\Test",
  profiles: { launcher: { command: "run %u" } },
  runProfile: "launcher",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("validates game definitions and string metadata", () => {
  const parsed = GameDefinitionSchema.parse({ ...game, productCode: "ABC" });
  assert(parsed.productCode === "ABC", "string metadata was not retained");
  assert(parsed.registry.length === 0, "default registry was not added");

  const invalidMetadata = GameDefinitionSchema.safeParse({
    ...game,
    productCode: 123,
  });
  assert(!invalidMetadata.success, "non-string metadata was accepted");
});

Deno.test("INFINITAS defaults include Wine registry declarations", async () => {
  const { defaultGames } = await import("../src/games.ts");
  const infinitas = defaultGames.find((game) => game.id === "infinitas");
  assert(
    infinitas?.registry.length === 4,
    "INFINITAS registry defaults are missing",
  );
});

Deno.test("rejects a missing run profile", () => {
  const result = GameDefinitionSchema.safeParse({
    ...game,
    runProfile: "missing",
  });
  assert(!result.success, "missing run profile was accepted");
  assert(
    result.error.issues[0]?.path.join(".") === "runProfile",
    "error did not identify runProfile",
  );
  assert(
    !GameDefinitionSchema.safeParse({
      ...game,
      profiles: {},
      runProfile: "toString",
    }).success,
    "prototype property was accepted as a profile",
  );
  assert(
    !GameDefinitionSchema.safeParse({
      ...game,
      profiles: Object.fromEntries([
        ["__proto__", { command: "run" }],
      ]),
      runProfile: "__proto__",
    }).success,
    "reserved profile name was accepted",
  );
});

Deno.test("merges game overrides without changing their order", () => {
  const original = GameDefinitionSchema.parse(game);
  const replacement = GameDefinitionSchema.parse({
    ...game,
    name: "Replacement",
  });
  const added = GameDefinitionSchema.parse({ ...game, id: "added" });
  const merged = mergeGameDefinitions([original], [replacement, added]);

  assert(merged.length === 2, "unexpected merged game count");
  assert(merged[0]?.name === "Replacement", "override was not applied");
  assert(merged[1]?.id === "added", "new game was not appended");
});
