import { Command } from "@cliffy/command";
import playwright from "patchright";
import $ from "@david/dax";
import * as path from "@std/path";
import { KEYRING_SERVICE, stateDir } from "./app.ts";
import { readKeyringPassword, writeKeyringPassword } from "./secret.ts";
import { resolveBrowserExecutable } from "./settings.ts";

const browserStorage = path.join(
  stateDir(),
  "browser-storage.json",
);

type SetBrowserCloser = (close: () => Promise<void>) => void;

async function launchBrowser(
  executablePath: string,
  setCloser?: SetBrowserCloser,
) {
  const browser = await playwright.chromium.launch({
    headless: false,
    executablePath: executablePath,
  });
  setCloser?.(() => browser.close());
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const storage = await $.path(browserStorage).exists()
      ? browserStorage
      : undefined;
    context = await browser.newContext({ storageState: storage });
    const initializedContext = context;
    const page = await initializedContext.newPage();
    const cdp = await initializedContext.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const virtualAuthenticator = await cdp.send(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          ctap2Version: "ctap2_1",
          hasUserVerification: true,
          transport: "internal",
          automaticPresenceSimulation: true,
          isUserVerified: true,
          hasResidentKey: true,
        },
      },
    );
    const close = async () => {
      try {
        await initializedContext.close();
      } finally {
        await browser.close();
      }
    };
    setCloser?.(close);
    return {
      browser,
      context: initializedContext,
      page,
      cdp,
      virtualAuthenticator,
      close,
      loadCredentials: async (service: string, name: string) => {
        const text = readKeyringPassword(service, name);
        if (!text) {
          throw new Error(
            "No credential found in keyring. Please run the registration or import keyring first.",
          );
        }
        const credential = JSON.parse(text);
        await cdp.send("WebAuthn.addCredential", {
          authenticatorId: virtualAuthenticator.authenticatorId,
          credential,
        });
      },
    };
  } catch (error) {
    try {
      await context?.close();
    } finally {
      await browser.close();
    }
    throw error;
  }
}

function registerCommand() {
  return new Command()
    .description("Register a passkey at visiting account page")
    .option("--browser <exe:file>", "The browser executable to use")
    .option(
      "-s, --start-url <url:string>",
      "The URL to start the registration process",
      { required: true, default: "https://my.konami.net/" },
    )
    .option(
      "--passkey-service <service:string>",
      "Service name for the passkey",
      {
        default: KEYRING_SERVICE,
      },
    )
    .option("--passkey-name <name:string>", "Name of the passkey", {
      default: "passkey-default",
    })
    .action(async (options) => {
      const b = await launchBrowser(
        await resolveBrowserExecutable(options.browser),
      );
      b.cdp.on("WebAuthn.credentialAdded", (payload) => {
        $.logStep(
          `Added credential: ${payload.credential.userDisplayName} (${payload.credential.credentialId})`,
        );
        $.logLight(JSON.stringify(payload.credential));
        writeKeyringPassword(
          options.passkeyService,
          options.passkeyName,
          JSON.stringify(payload.credential),
        );
      });

      await b.page.goto(options.startUrl);

      $.logWarn(
        "Please complete the passkey registration in the browser. When done, close the browser window to continue.",
      );
      await b.page.pause();

      await b.close();
    });
}

function recordCommand() {
  return new Command()
    .description("Record a login flow for development purposes")
    .hidden()
    .option("--browser <exe:file>", "The browser executable to use")
    .option(
      "-u, --url <url:string>",
      "The URL to visit for login",
      { required: true },
    )
    .option(
      "--passkey-service <service:string>",
      "Service name for the passkey",
      {
        default: KEYRING_SERVICE,
      },
    )
    .option("--passkey-name <name:string>", "Name of the passkey", {
      default: "passkey-default",
    })
    .action(async (options) => {
      const b = await launchBrowser(
        await resolveBrowserExecutable(options.browser),
      );
      b.loadCredentials(options.passkeyService, options.passkeyName);

      await b.page.goto(options.url);

      $.logWarn(
        "Please complete the login flow in the browser. When done, close the browser window to continue.",
      );
      await b.page.pause();

      await b.close();
    });
}

export type LaunchUrlOptions = {
  browser?: string;
  url: string;
  scheme: string;
  passkeyService: string;
  passkeyName: string;
};

export async function obtainLaunchUrl(
  options: LaunchUrlOptions,
): Promise<string> {
  let closeResource: (() => Promise<void>) | undefined;
  let closePromise: Promise<void> | undefined;
  let interruptedExitCode: number | undefined;
  const close = () => {
    if (!closeResource) return undefined;
    return closePromise ??= closeResource();
  };
  const setCloser = (closer: () => Promise<void>) => {
    closeResource = closer;
    if (interruptedExitCode !== undefined) {
      close()?.catch((error) => $.logError("Failed to close browser:", error));
    }
  };
  const stop = (exitCode: number) => {
    if (interruptedExitCode !== undefined) return;
    interruptedExitCode = exitCode;
    close()?.catch((error) => $.logError("Failed to close browser:", error));
  };
  const stopOnSigint = () => stop(130);
  const stopOnSigterm = () => stop(143);
  Deno.addSignalListener("SIGINT", stopOnSigint);
  Deno.addSignalListener("SIGTERM", stopOnSigterm);
  try {
    const b = await launchBrowser(
      await resolveBrowserExecutable(options.browser),
      setCloser,
    );
    if (interruptedExitCode !== undefined) {
      throw new Error("Browser launch interrupted");
    }
    await b.loadCredentials(options.passkeyService, options.passkeyName);

    await b.page.goto(options.url, { timeout: 30000 });
    await b.page.waitForLoadState("networkidle");

    let navigatedSchemeUrl: string | undefined;
    b.page.on("requestfailed", (request) => {
      $.logLight(
        `Failed request observed: ${request.url()} - ${request.failure()?.errorText}`,
      );
      if (request.url().startsWith(`${options.scheme}://`)) {
        navigatedSchemeUrl = request.url();
        $.log("Navigated to game URL scheme: ", navigatedSchemeUrl);
      }
    });

    try {
      await b.page.getByRole("link", { name: "ゲーム起動" }).click({
        timeout: 1000,
      });
    } catch (error) {
      $.logWarn("Failed to click the game launch link:", error);
    }

    try {
      await b.page.getByRole("link", { name: "起動処理を続ける" }).click({
        timeout: 1000,
      }).catch((error) => $.log("There is no continue link:", error));
      await b.page.getByRole("button", { name: "ゲーム起動" }).click({
        timeout: 1000,
      });
    } catch (error) {
      $.logWarn("Failed to click the game launch link:", error);
    }

    await b.page.waitForLoadState("networkidle");

    if (!navigatedSchemeUrl) {
      throw new Error(`No request with scheme ${options.scheme} found.`);
    }

    $.logStep("Successfully navigated to the game URL:", navigatedSchemeUrl);
    await $.path(browserStorage).parent()?.ensureDir();
    await b.context.storageState({ path: browserStorage });
    return navigatedSchemeUrl;
  } finally {
    Deno.removeSignalListener("SIGINT", stopOnSigint);
    Deno.removeSignalListener("SIGTERM", stopOnSigterm);
    try {
      await close();
    } finally {
      if (interruptedExitCode !== undefined) Deno.exit(interruptedExitCode);
    }
  }
}

function launchCommand() {
  return new Command()
    .description("Perform a login and launch the game")
    .hidden()
    .option("--browser <exe:file>", "The browser executable to use")
    .option(
      "-u, --url <url:string>",
      "The URL to visit after launching the browser",
      { required: true },
    )
    .option("-s, --scheme <scheme:string>", "The URL scheme to expect", {
      required: true,
    })
    .option(
      "--passkey-service <service:string>",
      "Service name for the passkey",
      {
        default: KEYRING_SERVICE,
      },
    )
    .option("--passkey-name <name:string>", "Name of the passkey", {
      default: "passkey-default",
    })
    .action(async (options) => {
      console.log(await obtainLaunchUrl(options));
    });
}

export const authCommand = new Command()
  .description("Authentication commands")
  .command("register-passkey", registerCommand())
  .command("record", recordCommand())
  .command("launch", launchCommand());
