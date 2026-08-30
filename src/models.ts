import { z } from "zod";
import { RegistryDeclarationsSchema } from "./registry_declaration.ts";

export const ProfileNameSchema = z.string().min(1).refine(
  (name) => name !== "__proto__" && name !== "common",
  { message: "Profile names '__proto__' and 'common' are reserved" },
);

const uniqueRegistryDeclarations = (
  registry: z.infer<typeof RegistryDeclarationsSchema>,
  context: z.RefinementCtx,
  path: (string | number)[],
) => {
  const seen = new Set<string>();
  for (const [index, entry] of registry.entries()) {
    const id = `${entry.key}\0${entry.name}`.toLocaleLowerCase();
    if (seen.has(id)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: "Registry key and value name must be unique",
      });
    }
    seen.add(id);
  }
};

export const CommonProfileSchema = z.object({
  env: z.record(z.string(), z.string().min(1)),
  registry: RegistryDeclarationsSchema,
}).strict();

export const GameProfileSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()),
  registry: RegistryDeclarationsSchema,
}).strict();

export const GameConfigSchema = z.object({
  common: CommonProfileSchema,
  profiles: z.record(ProfileNameSchema, GameProfileSchema),
  runProfile: ProfileNameSchema.nullable(),
}).strict().superRefine((config, context) => {
  if (
    typeof config.runProfile === "string" &&
    !Object.hasOwn(config.profiles, config.runProfile)
  ) {
    context.addIssue({
      code: "custom",
      path: ["runProfile"],
      message: `Profile '${config.runProfile}' does not exist`,
    });
  }
  uniqueRegistryDeclarations(config.common.registry, context, [
    "common",
    "registry",
  ]);
  for (const [name, profile] of Object.entries(config.profiles)) {
    uniqueRegistryDeclarations(profile.registry, context, [
      "profiles",
      name,
      "registry",
    ]);
  }
});

const GameDefinitionFields = {
  id: z.string().min(1),
  name: z.string().min(1),
  nameLocalized: z.record(z.string(), z.string()).optional(),
  urlScheme: z.string().min(1),
  loginUrl: z.url(),
  registryKey: z.string().min(1),
  common: CommonProfileSchema,
  profiles: z.record(ProfileNameSchema, GameProfileSchema),
  runProfile: ProfileNameSchema,
};

const GameDefinitionFieldNames = new Set(Object.keys(GameDefinitionFields));

export const GameDefinitionSchema = z.object(GameDefinitionFields)
  .passthrough()
  .superRefine((game, context) => {
    if (!Object.hasOwn(game.profiles, game.runProfile)) {
      context.addIssue({
        code: "custom",
        path: ["runProfile"],
        message: `Profile '${game.runProfile}' does not exist`,
      });
    }
    for (const [name, value] of Object.entries(game)) {
      if (!GameDefinitionFieldNames.has(name) && typeof value !== "string") {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Additional game metadata must be a string",
        });
      }
    }
  });

export const GameDefinitionsSchema = z.array(GameDefinitionSchema);

export const AppSettingsSchema = z.object({
  browser: z.string().min(1).optional(),
}).strict();

export const KonamateConfigSchema = z.object({
  settings: AppSettingsSchema,
  games: z.record(z.string().min(1), GameDefinitionSchema),
  profiles: z.record(z.string().min(1), GameConfigSchema),
}).strict();

export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type CommonProfile = z.infer<typeof CommonProfileSchema>;
export type GameConfig = z.infer<typeof GameConfigSchema>;
export type GameDefinition = z.infer<typeof GameDefinitionSchema>;
export type GameProfile = z.infer<typeof GameProfileSchema>;
export type KonamateConfig = z.infer<typeof KonamateConfigSchema>;
export type RegistryDeclaration = z.infer<
  typeof RegistryDeclarationsSchema
>[number];

export const emptyKonamateConfig = (): KonamateConfig => ({
  settings: {},
  games: {},
  profiles: {},
});
