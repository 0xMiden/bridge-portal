import { vi } from "vitest";

// Node requires absolute Request URLs. Keep viem's real HTTP transport and
// request options, supplying a test origin only for relative endpoints.
vi.mock("viem", async (importOriginal) => {
  const viem = await importOriginal<typeof import("viem")>();
  return {
    ...viem,
    http: (url: string | undefined, options: Parameters<typeof viem.http>[1]) =>
      viem.http(url?.startsWith("/") ? new URL(url, "https://bridge.example").href : url, options),
  };
});
