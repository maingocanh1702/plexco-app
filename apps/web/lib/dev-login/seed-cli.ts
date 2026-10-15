import { DevSeedRefusedError, runDevSeed } from "./seed";

/**
 * Entry point of `pnpm dev:seed` (root package.json runs it with tsx). Prints ids only — no email,
 * no key material, no connection string. Exit 0 on success, 1 on refusal or failure.
 */
async function main(): Promise<void> {
  try {
    const result = await runDevSeed(process.env);
    console.log(`dev:seed ok — tenant "Dev Club" ${result.tenantId}`);
    for (const [key, ids] of Object.entries(result.personas)) {
      console.log(`  persona ${key}: account ${ids.accountId} person ${ids.personId}`);
    }
    console.log(
      "Open http://127.0.0.1:<port>/dev-login on the dev server (see README, Dev-login).",
    );
  } catch (error) {
    if (error instanceof DevSeedRefusedError) {
      console.error(error.message);
    } else {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      console.error(`dev:seed failed: ${name}: ${message}`);
    }
    process.exitCode = 1;
  }
}

void main();
