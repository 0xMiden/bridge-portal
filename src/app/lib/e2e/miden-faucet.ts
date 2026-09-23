import { faucetMintAmount, solveFaucetPow } from "./faucet-pow";

// The public testnet faucet has no unauthenticated mint RPC. It hands out a
// note after a SHA-256 proof of work (GET /pow, then GET /get_tokens). A public
// note is what the client can see with syncState, without a note-transport key.

// api_url from https://faucet.testnet.miden.io/config.json. That frontend
// serves HTML at API paths, and config.json itself does not allow CORS.
const FAUCET_ORIGIN = "https://faucet-api-testnet-miden.eu-central-8.gateway.fm";

type FaucetMetadata = { id?: string; decimals?: number };
type PowChallenge = { challenge: string; target: number };
type FaucetMint = { tx_id: string; note_id: string };

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`faucet ${response.status} ${url}: ${(await response.text()).slice(0, 180)}`);
  }
  return (await response.json()) as T;
}

/**
 * Ask faucet.testnet.miden.io to mint a public note to `accountIdHex`.
 * The note still has to be consumed by that account before it sits in the vault.
 */
export async function requestTestnetFaucetNote(accountIdHex: string): Promise<FaucetMint> {
  const metadata = await readJson<FaucetMetadata>(`${FAUCET_ORIGIN}/get_metadata`);
  const amount = faucetMintAmount(metadata.decimals);
  const challenge = await readJson<PowChallenge>(
    `${FAUCET_ORIGIN}/pow?${new URLSearchParams({
      account_id: accountIdHex,
      amount: String(amount),
    })}`,
  );
  const nonce = solveFaucetPow(challenge.challenge, challenge.target);
  return readJson<FaucetMint>(
    `${FAUCET_ORIGIN}/get_tokens?${new URLSearchParams({
      account_id: accountIdHex,
      is_private_note: "false",
      asset_amount: String(amount),
      challenge: challenge.challenge,
      nonce: String(nonce),
    })}`,
  );
}
