import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getEnvironmentConfig, isMockRun } from "../config/environments";

const run = promisify(execFile);

// Miden counterparty driver (§3.3): wraps the `miden-client` CLI to fund the
// test account and read Miden state, version-pinned to the app's
// @miden-sdk/miden-sdk. Isolated per-run store dir. No-op in mock mode.
//
// ⚠️ The exact subcommands (faucet/mint/import) should be confirmed against the
// installed CLI version during first live validation — the wrapper shape and
// isolation are the load-bearing parts.

const BIN = process.env.MIDEN_CLIENT_BIN ?? "miden-client";

export class MidenCli {
  private readonly storeDir: string;
  private readonly env = getEnvironmentConfig();

  constructor() {
    this.storeDir = mkdtempSync(join(tmpdir(), "miden-e2e-"));
  }

  private async exec(args: string[]): Promise<string> {
    if (isMockRun()) return "";
    const { stdout } = await run(BIN, [...args], {
      cwd: this.storeDir,
      timeout: this.env.txTimeoutMs,
      env: { ...process.env, MIDEN_STORE_DIR: this.storeDir },
    });
    return stdout;
  }

  /** Initialise a client store pointed at the target network. */
  async init(): Promise<void> {
    await this.exec(["init", "--network", this.env.midenNetworkFlag]);
  }

  /** Sync the local store to the chain tip. */
  async sync(): Promise<void> {
    await this.exec(["sync"]);
  }

  /** Best-effort: request test funds for the account from the network faucet. */
  async fundAccount(accountId: string): Promise<void> {
    await this.exec(["mint", "--target", accountId]);
  }
}

export function makeMidenCli(): MidenCli {
  return new MidenCli();
}
