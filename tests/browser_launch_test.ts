import {
  captureLaunchUrl,
  type FailedRequest,
  type LaunchObservation,
  type LaunchPage,
} from "../src/browser_launch.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${actualJson} !== ${expectedJson}`);
}

function request(url: string): FailedRequest {
  return {
    url: () => url,
    failure: () => ({ errorText: "net::ERR_ABORTED" }),
  };
}

function fakePage(
  actions: Partial<
    Record<
      "button:ゲーム起動" | "link:ゲーム起動" | "link:起動処理を続ける",
      (emit: (request: FailedRequest) => void) => Promise<void> | void
    >
  >,
) {
  let listener: ((request: FailedRequest) => void) | undefined;
  const clicks: string[] = [];
  const page: LaunchPage = {
    getByRole: (role, { name }) => ({
      click: () => {
        const key = `${role}:${name}` as keyof typeof actions;
        clicks.push(key);
        return Promise.resolve(
          actions[key]?.((request) => listener?.(request)),
        );
      },
    }),
    on: (_event, value) => {
      listener = value;
    },
    off: (_event, value) => {
      if (listener === value) listener = undefined;
    },
  };
  return {
    clicks,
    emit: (value: FailedRequest) => listener?.(value),
    page,
    subscribed: () => listener !== undefined,
  };
}

function observation() {
  const failedRequests: string[] = [];
  const captured: string[] = [];
  const value: LaunchObservation = {
    onClickFailed: () => {},
    onContinueMissing: () => {},
    onRequestFailed: (failed) => failedRequests.push(failed.url()),
    onSchemeCaptured: (url) => captured.push(url),
  };
  return { captured, failedRequests, value };
}

Deno.test("completes at the first matching scheme without waiting for page state", async () => {
  const log = observation();
  const browser = fakePage({
    "link:ゲーム起動": (emit) =>
      emit(request("https://analytics.example.test/collect")),
    "link:起動処理を続ける": (emit) => {
      emit(request("konaste.sdvx://login?tk=first"));
      emit(request("konaste.sdvx://login?tk=second"));
      return new Promise(() => {});
    },
  });

  const url = await captureLaunchUrl(
    browser.page,
    "konaste.sdvx",
    log.value,
  );

  assertEquals(url, "konaste.sdvx://login?tk=first");
  assertEquals(browser.clicks, ["link:ゲーム起動", "link:起動処理を続ける"]);
  assertEquals(log.captured, ["konaste.sdvx://login?tk=first"]);
  assertEquals(log.failedRequests, [
    "https://analytics.example.test/collect",
    "konaste.sdvx://login?tk=first",
    "konaste.sdvx://login?tk=second",
  ]);
  assert(!browser.subscribed(), "request listener remained subscribed");
});

Deno.test("times out when no matching scheme is observed", async () => {
  const log = observation();
  const browser = fakePage({});
  let error: unknown;

  try {
    await captureLaunchUrl(browser.page, "konaste.sdvx", log.value, 1);
  } catch (cause) {
    error = cause;
  }

  assert(
    error instanceof Error &&
      error.message ===
        "No request with scheme konaste.sdvx found within 1ms.",
    `unexpected error: ${String(error)}`,
  );
  assertEquals(browser.clicks, [
    "link:ゲーム起動",
    "link:起動処理を続ける",
    "button:ゲーム起動",
  ]);
  assert(!browser.subscribed(), "request listener remained subscribed");
});
