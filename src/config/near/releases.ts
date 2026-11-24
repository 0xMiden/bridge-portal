import v1 from "./v1.json" with { type: "json" };

// Polygon moved these same six-decimal contracts to the Omni Bridge asset IDs.
const polygonPins = new Map([
  ["mainnet:near-miden-usdcx-to-polygon-usdc", "nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near"],
  ["mainnet:near-miden-usdt-to-polygon-usdt", "nep141:pol-0xc2132d05d31c914a87c6611c10748aeb04b58e8f.omdep.near"],
]);

const v2 = {
  ...v1, version: 2, evidenceDate: "2026-11-19",
  routes: v1.routes.map(route => {
    const assetId = polygonPins.get(route.id);
    return assetId ? { ...route, destination: { ...route.destination, assetId } } : route;
  }),
};

export const activeNearRelease = {
  ...v2,
  version: 3,
  evidenceDate: "2026-11-23",
  // The sender can reclaim an unconsumed note after roughly five hours.
  funding: { ...v2.funding, script: "p2ide", reclaimBlocks: 5_200 },
};
