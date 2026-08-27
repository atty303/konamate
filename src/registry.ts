import * as path from "@std/path";
import $ from "@david/dax";
import { type RegistryDeclaration } from "./config.ts";
import {
  parseRegistryKey,
  type RegistryHive,
  type RegistryLocation,
} from "./registry_key.ts";
import { findValue, readRegistryFile, type RegistryValue } from "./winereg.ts";

function registryFile(prefix: string, hive: RegistryHive): string {
  switch (hive) {
    case "HKCU":
      return path.join(prefix, "user.reg");
    case "HKLM":
      return path.join(prefix, "system.reg");
  }
}

function sectionPath(key: string): string {
  return key.replaceAll("\\", "\\\\");
}

function formatName(name: string): string {
  return name === ""
    ? "@"
    : `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function formatValue(
  declaration: Extract<RegistryDeclaration, { action: "set" }>,
): string {
  if (declaration.type === "dword") {
    const value = declaration.value;
    if (typeof value !== "number") {
      throw new Error("Invalid DWORD registry value");
    }
    return `dword:${value.toString(16).padStart(8, "0")}`;
  }
  const value = declaration.value;
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error("Invalid string registry value");
  }
  return `"${
    value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll(
      "\n",
      "\\n",
    ).replaceAll("\r", "\\r").replaceAll("\t", "\\t")
  }"`;
}

function escapedPathEquals(header: string, key: string): boolean {
  return header.replaceAll("\\\\", "\\").toLocaleLowerCase() ===
    key.toLocaleLowerCase();
}

function valueName(line: string): string | undefined {
  const raw = line.trimStart();
  if (raw.startsWith("@=")) return "";
  if (!raw.startsWith('"')) return undefined;
  let escaped = false;
  for (let index = 1; index < raw.length; index++) {
    const character = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character !== '"') continue;
    if (raw.slice(index + 1).trimStart().startsWith("=")) {
      return raw.slice(1, index).replaceAll('\\"', '"').replaceAll(
        "\\\\",
        "\\",
      );
    }
    return undefined;
  }
  return undefined;
}

function updateText(
  original: string,
  location: RegistryLocation,
  declaration: RegistryDeclaration,
): string {
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(newline);
  const targetPath = sectionPath(location.key);
  let section = -1;
  let end = lines.length;

  for (let index = 0; index < lines.length; index++) {
    const match = /^\[([^\]]+)\]/.exec(lines[index].trim());
    if (!match) continue;
    if (section !== -1) {
      end = index;
      break;
    }
    if (escapedPathEquals(match[1], location.key)) section = index;
  }

  if (section === -1) {
    if (declaration.action === "delete") return original;
    const prefix = original.length === 0 || original.endsWith(newline)
      ? original
      : `${original}${newline}`;
    return `${prefix}${newline}[${targetPath}]${newline}${
      formatName(declaration.name)
    }=${formatValue(declaration)}${newline}`;
  }

  let valueLine = -1;
  for (let index = section + 1; index < end; index++) {
    const name = valueName(lines[index]);
    if (
      name !== undefined &&
      name.toLocaleLowerCase() === declaration.name.toLocaleLowerCase()
    ) {
      valueLine = index;
      break;
    }
  }

  let valueEnd = valueLine + 1;
  while (
    valueLine !== -1 &&
    valueEnd < end &&
    lines[valueEnd - 1].trimEnd().endsWith("\\")
  ) {
    valueEnd++;
  }

  if (declaration.action === "delete") {
    if (valueLine === -1) return original;
    lines.splice(valueLine, valueEnd - valueLine);
    return lines.join(newline);
  }

  const next = `${formatName(declaration.name)}=${formatValue(declaration)}`;
  if (valueLine === -1) {
    lines.splice(end, 0, next);
  } else if (valueEnd === valueLine + 1 && lines[valueLine] === next) {
    return original;
  } else {
    lines.splice(valueLine, valueEnd - valueLine, next);
  }
  return lines.join(newline);
}

export class RegistryService {
  constructor(readonly prefix: string) {
    if (!path.isAbsolute(prefix)) {
      throw new Error(
        "WINEPREFIX must be an absolute path for registry operations",
      );
    }
  }

  async read(key: string, name: string): Promise<RegistryValue | null> {
    const location = parseRegistryKey(key);
    const registry = await readRegistryFile(
      registryFile(this.prefix, location.hive),
    );
    return findValue(registry, location.key, name);
  }

  async readLocalMachine(
    key: string,
    name: string,
  ): Promise<RegistryValue | null> {
    return await this.read(`HKLM\\${key}`, name);
  }

  async apply(declarations: RegistryDeclaration[]): Promise<void> {
    if (declarations.length === 0) return;

    const byFile = new Map<string, RegistryDeclaration[]>();
    for (const declaration of declarations) {
      const location = parseRegistryKey(declaration.key);
      const file = registryFile(this.prefix, location.hive);
      byFile.set(file, [...(byFile.get(file) ?? []), declaration]);
    }

    for (const [file, entries] of byFile) {
      const original = await (async () => {
        try {
          return await Deno.readTextFile(file);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
          $.logWarn(`Registry file not found; skipping: ${file}`);
          return undefined;
        }
      })();
      if (original === undefined) continue;
      let content = original;
      for (const entry of entries) {
        content = updateText(content, parseRegistryKey(entry.key), entry);
      }
      if (content === original) continue;
      const stat = await Deno.stat(file);
      const temporary = await Deno.makeTempFile({
        dir: path.dirname(file),
        prefix: ".konamate-registry-",
      });
      try {
        await Deno.writeTextFile(temporary, content);
        if (stat.mode !== null) await Deno.chmod(temporary, stat.mode);
        await Deno.rename(temporary, file);
      } finally {
        await Deno.remove(temporary).catch(() => undefined);
      }
    }
  }
}
