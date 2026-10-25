import { readFile, readdir } from "node:fs/promises";

/** Load the exact browser WASM used by the app, avoiding the SDK's native Node API. */
export async function browserMidenSdk(): Promise<typeof import("@miden-sdk/miden-sdk")> {
  const directory = new URL("../node_modules/@miden-sdk/miden-sdk/dist/st/", import.meta.url);
  const glue = (await readdir(directory)).find(name => /^Cargo-.*\.js$/.test(name));
  if (!glue) throw new Error("Pinned Miden SDK browser WASM entry not found");
  const sdk = await import(/* @vite-ignore */ new URL(glue, directory).href);
  sdk.initSync({ module: await readFile(new URL("assets/miden_client_web.wasm", directory)) });
  return sdk;
}
