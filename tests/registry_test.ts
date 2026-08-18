import { RegistryService } from "../src/registry.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("RegistryService updates only declared values in the matching hive", async () => {
  const prefix = await Deno.makeTempDir();
  const userReg = `${prefix}/user.reg`;
  try {
    const original =
      `WINE REGISTRY Version 2\n\n#arch=win64\n[Software\\\\Wine\\\\Explorer] 1\n#time=1\n"Existing"="keep"\n"Desktop"="Old"\n\n[Other\\\\Key]\n"Untouched"="yes"\n`;
    await Deno.writeTextFile(userReg, original);
    await Deno.writeTextFile(
      `${prefix}/system.reg`,
      "WINE REGISTRY Version 2\n",
    );

    const service = new RegistryService(prefix, () => Promise.resolve(false));
    await service.apply([
      {
        action: "set",
        key: "HKCU\\Software\\Wine\\Explorer",
        name: "Desktop",
        type: "string",
        value: "Default",
      },
      {
        action: "set",
        key: "HKCU\\Software\\Wine\\X11 Driver",
        name: "Decorated",
        type: "string",
        value: "N",
      },
    ]);

    const updated = await Deno.readTextFile(userReg);
    assert(updated.includes("#arch=win64"), "prefix architecture was changed");
    assert(
      updated.includes('"Existing"="keep"'),
      "unmanaged value was changed",
    );
    assert(
      updated.includes('[Other\\\\Key]\n"Untouched"="yes"'),
      "unmanaged key was changed",
    );
    assert(
      updated.includes('"Desktop"="Default"'),
      "existing value was not updated",
    );
    assert(
      updated.includes('[Software\\\\Wine\\\\X11 Driver]\n"Decorated"="N"'),
      "new value was not added",
    );

    await service.apply([{
      action: "delete",
      key: "HKCU\\Software\\Wine\\Explorer",
      name: "Desktop",
    }]);
    assert(
      !(await Deno.readTextFile(userReg)).includes('"Desktop"='),
      "value was not deleted",
    );

    await Deno.writeTextFile(
      userReg,
      `${original}\n[Software\\\\Wine\\\\Overrides]\n"Value"=hex(2):41,00,\\\\\n  00,00\n`,
    );
    await service.apply([{
      action: "set",
      key: "HKCU\\Software\\Wine\\Overrides",
      name: "Value",
      type: "string",
      value: "replacement",
    }]);
    const replaced = await Deno.readTextFile(userReg);
    assert(
      !replaced.includes("  00,00"),
      "continued registry value line was left behind after replacement",
    );

    await service.apply([{
      action: "delete",
      key: "HKCU\\Software\\Wine\\Overrides",
      name: "Value",
    }]);
    assert(
      !(await Deno.readTextFile(userReg)).includes('"Value"='),
      "continued registry value was not deleted",
    );

    await service.apply([{
      action: "set",
      key: "HKCU\\Software\\Wine\\Explorer",
      name: "a=b",
      type: "string",
      value: "first",
    }]);
    await service.apply([{
      action: "set",
      key: "HKCU\\Software\\Wine\\Explorer",
      name: "a=b",
      type: "string",
      value: "second",
    }]);
    const namedValue = await Deno.readTextFile(userReg);
    assert(
      namedValue.match(/"a=b"=/g)?.length === 1,
      "quoted value name was duplicated",
    );
    await service.apply([{
      action: "delete",
      key: "HKCU\\Software\\Wine\\Explorer",
      name: "a=b",
    }]);
    assert(
      !(await Deno.readTextFile(userReg)).includes('"a=b"='),
      "quoted value name was not deleted",
    );
  } finally {
    await Deno.remove(prefix, { recursive: true });
  }
});

Deno.test("RegistryService preserves the prefix when activity cannot be checked", async () => {
  const prefix = await Deno.makeTempDir();
  const userReg = `${prefix}/user.reg`;
  try {
    const original = "WINE REGISTRY Version 2\n";
    await Deno.writeTextFile(userReg, original);
    await Deno.writeTextFile(`${prefix}/system.reg`, original);
    const service = new RegistryService(
      prefix,
      () => Promise.reject(new Error("inspection denied")),
    );
    let rejected = false;
    try {
      await service.apply([{
        action: "set",
        key: "HKCU\\Software\\Wine\\Explorer",
        name: "Desktop",
        type: "string",
        value: "Default",
      }]);
    } catch {
      rejected = true;
    }
    assert(rejected, "unknown prefix activity was accepted");
    assert(await Deno.readTextFile(userReg) === original, "prefix was changed");
  } finally {
    await Deno.remove(prefix, { recursive: true });
  }
});

Deno.test("RegistryService rejects a relative Wine prefix", () => {
  let rejected = false;
  try {
    new RegistryService("relative-prefix");
  } catch (error) {
    rejected = error instanceof Error && /absolute path/.test(error.message);
  }
  assert(rejected, "relative prefix was accepted");
});

Deno.test("RegistryService reads local-machine values through the prefix service", async () => {
  const prefix = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${prefix}/user.reg`, "WINE REGISTRY Version 2\n");
    await Deno.writeTextFile(
      `${prefix}/system.reg`,
      'WINE REGISTRY Version 2\n\n[Software\\\\KONAMI\\\\Game]\n"InstallDir"="C:\\\\Games\\\\Game"\n',
    );
    const value = await new RegistryService(prefix).readLocalMachine(
      "Software\\KONAMI\\Game",
      "InstallDir",
    );
    assert(value?.type === "REG_SZ", "installation directory was not read");
    assert(
      value.data === "C:\\Games\\Game",
      "installation directory was changed",
    );
  } finally {
    await Deno.remove(prefix, { recursive: true });
  }
});
