import data from "./wallet-config/token-connections.json";
import { tokenConnectionsSchema } from "./wallet-config/token-connections";

/** Portal-owned token pairs; deployments use wallet-config plus the explicit Cedar Epoch rollout. */
export const tokenRegistry = tokenConnectionsSchema.parse(data);
