export type FailedRequest = {
  url(): string;
  failure(): { errorText: string } | null;
};

type ClickOptions = {
  timeout: number;
};

type LaunchLocator = {
  click(options: ClickOptions): Promise<void>;
};

export type LaunchPage = {
  getByRole(
    role: "button" | "link",
    options: { name: string },
  ): LaunchLocator;
  on(event: "requestfailed", listener: (request: FailedRequest) => void): void;
  off(event: "requestfailed", listener: (request: FailedRequest) => void): void;
};

export type LaunchObservation = {
  onClickFailed(error: unknown): void;
  onContinueMissing(error: unknown): void;
  onRequestFailed(request: FailedRequest): void;
  onSchemeCaptured(url: string): void;
};

const clickTimeoutMs = 1_000;
const schemeTimeoutMs = 30_000;

export async function captureLaunchUrl(
  page: LaunchPage,
  scheme: string,
  observation: LaunchObservation,
  timeout = schemeTimeoutMs,
): Promise<string> {
  const captured = Promise.withResolvers<string>();
  let capturedUrl: string | undefined;
  const onRequestFailed = (request: FailedRequest) => {
    observation.onRequestFailed(request);
    const url = request.url();
    if (capturedUrl || !url.startsWith(`${scheme}://`)) return;

    capturedUrl = url;
    observation.onSchemeCaptured(url);
    captured.resolve(url);
  };
  page.on("requestfailed", onRequestFailed);

  const click = async (
    locator: LaunchLocator,
    onFailure: (error: unknown) => void,
  ) => {
    if (capturedUrl) return;
    const click = locator.click({ timeout: clickTimeoutMs }).then(
      () => ({ type: "completed" } as const),
      (error: unknown) => ({ error, type: "failed" } as const),
    );
    const outcome = await Promise.race([
      click,
      captured.promise.then(() => ({ type: "captured" } as const)),
    ]);
    if (outcome.type === "failed" && !capturedUrl) {
      onFailure(outcome.error);
    }
  };

  try {
    await click(
      page.getByRole("link", { name: "ゲーム起動" }),
      observation.onClickFailed,
    );
    await click(
      page.getByRole("link", { name: "起動処理を続ける" }),
      observation.onContinueMissing,
    );
    await click(
      page.getByRole("button", { name: "ゲーム起動" }),
      observation.onClickFailed,
    );

    if (capturedUrl) return capturedUrl;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        captured.promise,
        new Promise<string>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `No request with scheme ${scheme} found within ${timeout}ms.`,
                ),
              ),
            timeout,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } finally {
    page.off("requestfailed", onRequestFailed);
  }
}
