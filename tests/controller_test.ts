import {
  ControllerState,
  isButtonPressed,
  readJoystickState,
} from "../src/controller.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${actualJson} !== ${expectedJson}`);
}

Deno.test("detects current button state and ignores axes", () => {
  const state: ControllerState = new Map([
    ["axis:0", { type: "axis", number: 0, value: 1 }],
    ["button:0", { type: "button", number: 0, value: 0 }],
    ["button:1", { type: "button", number: 1, value: 1 }],
  ]);

  assert(isButtonPressed(state), "any pressed button was not detected");
  assertEquals(isButtonPressed(state, 0), false);
  assert(isButtonPressed(state, 1), "pressed button was not detected");
  assertEquals(isButtonPressed(state, 2), false);
});

Deno.test("keeps the latest event for each control", async () => {
  const event = (value: number, type: number, number: number) => {
    const data = new Uint8Array(8);
    const view = new DataView(data.buffer);
    view.setInt16(4, value, true);
    view.setUint8(6, type);
    view.setUint8(7, number);
    return data;
  };
  const device = await Deno.makeTempFile();
  try {
    const events = new Uint8Array([
      ...event(0, 0x01, 0),
      ...event(1, 0x01, 0),
      ...event(-123, 0x02, 0),
    ]);
    await Deno.writeFile(device, events);

    const state = await readJoystickState(device);

    assertEquals(Array.from(state.values()), [
      { type: "button", number: 0, value: 1 },
      { type: "axis", number: 0, value: -123 },
    ]);
  } finally {
    await Deno.remove(device);
  }
});

Deno.test("stops reading at the absolute deadline", async () => {
  const startedAt = performance.now();
  const state = await readJoystickState("/dev/zero");

  assertEquals(state.size, 0);
  assert(
    performance.now() - startedAt < 1_000,
    "continuous input extended the read deadline",
  );
});

Deno.test("rejects device types that can block while opening", async () => {
  const directory = await Deno.makeTempDir();
  const fifo = `${directory}/controller`;
  try {
    const mkfifo = await new Deno.Command("mkfifo", { args: [fifo] }).output();
    assert(mkfifo.success, "failed to create controller FIFO");

    let rejected = false;
    try {
      await readJoystickState(fifo);
    } catch {
      rejected = true;
    }
    assert(rejected, "FIFO was accepted as a controller device");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("closes the device when reading fails", async () => {
  let rejected = false;
  try {
    await readJoystickState("/tmp");
  } catch {
    rejected = true;
  }
  assert(rejected, "directory read unexpectedly succeeded");
});

Deno.test("pressed reserves exit code 1 for a released controller", async () => {
  const runPressed = async (
    args: string[],
    xdgConfigHome: string,
  ): Promise<Deno.CommandOutput> => {
    return await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "src/main.ts",
        "controller",
        "pressed",
        ...args,
      ],
      env: { XDG_CONFIG_HOME: xdgConfigHome },
      stdout: "piped",
      stderr: "piped",
    }).output();
  };

  const xdgConfigHome = await Deno.makeTempDir();
  try {
    assertEquals(
      (await runPressed(
        ["-d", "/dev/null", "--button", "255"],
        xdgConfigHome,
      )).code,
      1,
    );
    assertEquals(
      (await runPressed(
        ["-d", "/dev/null", "--button", "256"],
        xdgConfigHome,
      )).code,
      2,
    );
    assertEquals(
      (await runPressed(
        ["-d", `${xdgConfigHome}/missing-controller`],
        xdgConfigHome,
      )).code,
      2,
    );
    const incompleteDevice = `${xdgConfigHome}/incomplete-controller`;
    await Deno.writeFile(incompleteDevice, new Uint8Array([0]));
    assertEquals(
      (await runPressed(["-d", incompleteDevice], xdgConfigHome)).code,
      2,
    );
    const configDir = `${xdgConfigHome}/konamate`;
    await Deno.mkdir(configDir);
    await Deno.writeTextFile(`${configDir}/games.json`, "not json");
    assertEquals(
      (await runPressed(["-d", "/dev/null"], xdgConfigHome)).code,
      2,
    );
  } finally {
    await Deno.remove(xdgConfigHome, { recursive: true });
  }
});
