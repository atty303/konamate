import { Command } from "@cliffy/command";
import { Entry } from "@napi-rs/keyring";
import { DEFAULT_PASSKEY_NAME, KEYRING_SERVICE } from "./app.ts";
import { PasswordStore, readPasswordWithMigration } from "./password.ts";

const keyringStore: PasswordStore = {
  get(service, name) {
    return new Entry(service, name).getPassword() ?? undefined;
  },
  set(service, name, password) {
    new Entry(service, name).setPassword(password);
  },
};

export function readKeyringPassword(
  service: string,
  name: string,
): string | undefined {
  return readPasswordWithMigration(keyringStore, service, name);
}

export function writeKeyringPassword(
  service: string,
  name: string,
  password: string,
): void {
  keyringStore.set(service, name, password);
}

function importCommand() {
  return new Command()
    .description("Import a secret to the keyring")
    .example(
      "Import a secret from stdin",
      "cat secret.json | konamate secret import --name <name>",
    )
    .option("-s, --service <service:string>", "Service name for the secret", {
      default: KEYRING_SERVICE,
    })
    .option("-n, --name <name:string>", "Name of the secret", {
      default: DEFAULT_PASSKEY_NAME,
    })
    .action(async (options) => {
      if (Deno.stdin) {
        const text = await new Response(Deno.stdin.readable).text();
        if (!text) {
          throw new Error("No input provided. Please provide a secret.");
        }
        writeKeyringPassword(options.service, options.name, text);
      }
    });
}

function exportCommand() {
  return new Command()
    .description("Export a secret from the keyring")
    .option("-s, --service <service:string>", "Service name for the secret", {
      default: KEYRING_SERVICE,
    })
    .option("-n, --name <name:string>", "Name of the secret", {
      default: DEFAULT_PASSKEY_NAME,
    })
    .action((options) => {
      const text = readKeyringPassword(options.service, options.name);
      if (!text) {
        throw new Error("No secret found in keyring.");
      }
      console.log(text);
    });
}

export const secretCommand = new Command()
  .description("Manage secrets")
  .command("import", importCommand())
  .command("export", exportCommand());
