import { Command } from "@cliffy/command";

type EventType = "button" | "axis";

export type ControllerState = Map<string, {
  type: EventType;
  number: number;
  value: number;
}>;

const JS_EVENT_BUTTON = 0x01;
const JS_EVENT_AXIS = 0x02;
const JS_EVENT_INIT = 0x80;
const MAX_BUTTON_NUMBER = 0xff;
const FILE_TYPE_MASK = 0o170000;
const FILE_TYPE_CHARACTER_DEVICE = 0o020000;
const FILE_TYPE_REGULAR = 0o100000;

function parseJoystickEvent(data: DataView) {
  const time = data.getUint32(0, true);
  const value = data.getInt16(4, true);
  const type = data.getUint8(6);
  const number = data.getUint8(7);

  const isInit = (type & JS_EVENT_INIT) !== 0;
  const isButton = (type & JS_EVENT_BUTTON) !== 0;
  const isAxis = (type & JS_EVENT_AXIS) !== 0;

  return {
    time,
    value,
    isInit,
    type: isButton ? "button" as const : isAxis ? "axis" as const : undefined,
    number,
  };
}

function eventKey(type: EventType, number: number): string {
  return `${type}:${number}`;
}

export async function readJoystickState(device: string) {
  const info = await Deno.stat(device);
  const fileType = (info.mode ?? 0) & FILE_TYPE_MASK;
  if (
    fileType !== FILE_TYPE_CHARACTER_DEVICE && fileType !== FILE_TYPE_REGULAR
  ) {
    throw new Error(`Unsupported controller device file type: ${device}`);
  }

  const file = await Deno.open(device, { read: true });
  const state: ControllerState = new Map();
  let timedOut = false;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    file.close();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    close();
  }, 100);

  try {
    while (true) {
      const buffer = new Uint8Array(8);
      let readed: number | null;
      try {
        readed = await file.read(buffer);
      } catch (error) {
        if (timedOut) return state;
        throw error;
      }
      if (!readed) return state;
      if (readed < 8) throw new Error("Incomplete joystick event");

      const event = parseJoystickEvent(new DataView(buffer.buffer));
      if (event.type) {
        state.set(eventKey(event.type, event.number), {
          type: event.type,
          number: event.number,
          value: event.value,
        });
      }
    }
  } finally {
    clearTimeout(timer);
    close();
  }
}

async function readCurrentJoystickState(device: string) {
  // Discard the first events to ensure we get the latest state
  await readJoystickState(device);
  return await readJoystickState(device);
}

export function isButtonPressed(
  state: ControllerState,
  button?: number,
): boolean {
  if (button !== undefined) {
    return state.get(eventKey("button", button))?.value === 1;
  }
  return Array.from(state.values()).some((event) =>
    event.type === "button" && event.value === 1
  );
}

const readCommand = new Command()
  .description("Read controller state")
  .option("-d, --device <device:string>", "Device path", {
    required: true,
  })
  .action(async (options) => {
    const state = await readCurrentJoystickState(options.device);
    const states = Array.from(state.values());
    console.log(JSON.stringify(states, null, 2));
    Deno.exit(0);
  });

const pressedCommand = new Command()
  .description(
    "Test whether a button is pressed (exit 0 if pressed, 1 if not, 2 on error)",
  )
  .option("-d, --device <device:string>", "Device path", {
    required: true,
  })
  .option("-b, --button <number:number>", "Button number")
  .error((error) => {
    console.error(error.message);
    Deno.exit(2);
  })
  .action(async (options) => {
    if (
      options.button !== undefined &&
      (!Number.isInteger(options.button) || options.button < 0 ||
        options.button > MAX_BUTTON_NUMBER)
    ) {
      console.error("Button number must be an integer between 0 and 255");
      Deno.exit(2);
    }

    try {
      const state = await readCurrentJoystickState(options.device);
      Deno.exit(isButtonPressed(state, options.button) ? 0 : 1);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(2);
    }
  });

export const controllerCommand = new Command()
  .description("Controller management commands")
  .command("read", readCommand)
  .command("pressed", pressedCommand);
