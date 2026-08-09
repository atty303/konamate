import { z } from "zod";

export async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let value: unknown;
  try {
    value = JSON.parse(await Deno.readTextFile(filePath));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid data in ${filePath}:\n${z.prettifyError(result.error)}`,
      { cause: result.error },
    );
  }
  return result.data;
}
