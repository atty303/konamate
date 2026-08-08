import { Command } from "@cliffy/command";
import playwright from "patchright";
import { Entry } from "@napi-rs/keyring";
import $ from "@david/dax";
import * as path from "@std/path";
import xdg from "@404wolf/xdg-portable";

const browserStorage = path.join(
  xdg.state(),
  "konaste-buddy",
  "browser-storage.json",
);
$.path(browserStorage).parent()?.ensureDir();

async function launchBrowser(executablePath?: string) {
  const browser = await playwright.chromium.launch({
    headless: false,
    executablePath: executablePath,
  });
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
    return {
      browser,
      context: initializedContext,
      page,
      cdp,
      virtualAuthenticator,
      close: async () => {
        try {
          await initializedContext.close();
        } finally {
          await browser.close();
        }
      },
      loadCredentials: async (service: string, name: string) => {
        const entry = new Entry(service, name);
        const text = entry.getPassword();
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
    .option("--browser <exe:file>", "The browser executable to use", {
      required: true,
    })
    .option(
      "-s, --start-url <url:string>",
      "The URL to start the registration process",
      { required: true, default: "https://my.konami.net/" },
    )
    .option(
      "--passkey-service <service:string>",
      "Service name for the passkey",
      {
        default: "io.github.atty303.konaste-buddy",
      },
    )
    .option("--passkey-name <name:string>", "Name of the passkey", {
      default: "passkey-default",
    })
    .action(async (options) => {
      const b = await launchBrowser(options.browser);
      b.cdp.on("WebAuthn.credentialAdded", (payload) => {
        $.logStep(
          `Added credential: ${payload.credential.userDisplayName} (${payload.credential.credentialId})`,
        );
        $.logLight(JSON.stringify(payload.credential));
        const entry = new Entry(options.passkeyService, options.passkeyName);
        entry.setPassword(JSON.stringify(payload.credential));
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
    .option("--browser <exe:file>", "The browser executable to use", {
      required: true,
    })
    .option(
      "-u, --url <url:string>",
      "The URL to visit for login",
      { required: true },
    )
    .option(
      "--passkey-service <service:string>",
      "Service name for the passkey",
      {
        default: "io.github.atty303.konaste-buddy",
      },
    )
    .option("--passkey-name <name:string>", "Name of the passkey", {
      default: "passkey-default",
    })
    .action(async (options) => {
      const b = await launchBrowser(options.browser);
      b.loadCredentials(options.passkeyService, options.passkeyName);

      await b.page.goto(options.url);

      $.logWarn(
        "Please complete the login flow in the browser. When done, close the browser window to continue.",
      );
      await b.page.pause();

      await b.close();
    });
}

function launchCommand() {
  return new Command()
    .description("Perform a login and launch the game")
    .option("--browser <exe:file>", "The browser executable to use", {
      required: true,
    })
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
        default: "io.github.atty303.konaste-buddy",
      },
    )
    .option("--passkey-name <name:string>", "Name of the passkey", {
      default: "passkey-default",
    })
    .action(async (options) => {
      const b = await launchBrowser(options.browser);
      let closePromise: Promise<void> | undefined;
      const close = () => closePromise ??= b.close();
      let interrupted = false;
      const stop = (exitCode: number) => {
        if (interrupted) return;
        interrupted = true;
        close().catch((error) => $.logError("Failed to close browser:", error))
          .finally(() => Deno.exit(exitCode));
      };
      const stopOnSigint = () => stop(130);
      const stopOnSigterm = () => stop(143);
      Deno.addSignalListener("SIGINT", stopOnSigint);
      Deno.addSignalListener("SIGTERM", stopOnSigterm);
      try {
        await b.loadCredentials(options.passkeyService, options.passkeyName);

        await b.page.goto(options.url, { timeout: 30000 });

        await b.page.waitForLoadState("networkidle");

        let navigatedSchemeUrl: string | undefined = undefined;
        // Some games have a direct link to a game URL scheme then fails navigation
        // (e.g., bm2dxinf://)
        b.page.on("requestfailed", (request) => {
          $.logLight(
            `Failed request observed: ${request.url()} - ${request.failure()?.errorText}`,
          );
          if (request.url().startsWith(`${options.scheme}://`)) {
            navigatedSchemeUrl = request.url();
            $.log("Navigated to game URL scheme: ", navigatedSchemeUrl);
          }
        });

        // Try to click button for INFINITAS
        try {
          await b.page.getByRole("link", { name: "ゲーム起動" }).click({
            timeout: 1000,
          });
        } catch (error) {
          $.logWarn("Failed to click the game launch link:", error);
        }

        // Try to click button for SDVX
        try {
          await b.page.getByRole("link", { name: "起動処理を続ける" }).click({
            timeout: 1000,
          }).catch((error) => $.log("There is no continue link:", error));
          await b.page.getByRole("button", { name: "ゲーム起動" }).click({
            timeout: 1000,
          });
        } catch (error) {
          // Some games redirect to a game URL scheme by script then net::ERR_ABORTED error occurs
          // (e.g., konaste.sdvx://)
          $.logWarn("Failed to click the game launch link:", error);
        }

        await b.page.waitForLoadState("networkidle");

        if (!navigatedSchemeUrl) {
          throw new Error(
            `No request with scheme ${options.scheme} found.`,
          );
        }

        $.logStep(
          "Successfully navigated to the game URL:",
          navigatedSchemeUrl,
        );
        console.log(navigatedSchemeUrl);

        await b.context.storageState({ path: browserStorage });
      } finally {
        Deno.removeSignalListener("SIGINT", stopOnSigint);
        Deno.removeSignalListener("SIGTERM", stopOnSigterm);
        await close();
      }
    });
}

export const browserCommand = new Command()
  .description("Browser management commands")
  .command("register-passkey", registerCommand())
  .command("record", recordCommand())
  .command("launch", launchCommand());
