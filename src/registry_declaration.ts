import { z } from "zod";
import { isRegistryKey } from "./registry_key.ts";

const RegistryValueNameSchema = z.string().refine(
  (name) => !/[\r\n\0]/.test(name),
  "Registry value name cannot contain a newline or NUL",
);
const RegistryStringValueSchema = z.string().refine(
  (value) => !value.includes("\0"),
  "Registry string value cannot contain NUL",
);

export const RegistryDeclarationsSchema = z.array(
  z.discriminatedUnion("action", [
    z.object({
      action: z.literal("set"),
      key: z.string().refine(
        isRegistryKey,
        "Registry key must start with HKCU or HKLM",
      ),
      name: RegistryValueNameSchema,
      type: z.enum(["string", "dword"]),
      value: z.union([
        RegistryStringValueSchema,
        z.number().int().min(0).max(0xffff_ffff),
      ]),
    }).strict().superRefine((value, context) => {
      if (value.type === "string" && typeof value.value !== "string") {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message: "String registry values require a string",
        });
      }
      if (value.type === "dword" && typeof value.value !== "number") {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message: "DWORD registry values require an unsigned 32-bit integer",
        });
      }
    }),
    z.object({
      action: z.literal("delete"),
      key: z.string().refine(
        isRegistryKey,
        "Registry key must start with HKCU or HKLM",
      ),
      name: RegistryValueNameSchema,
    }).strict(),
  ]),
);

export type RegistryDeclaration = z.infer<
  typeof RegistryDeclarationsSchema
>[number];
