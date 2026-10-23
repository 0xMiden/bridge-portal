import data from "./wallet-config/token-connections.json";
import { tokenConnectionsSchema } from "./wallet-config/token-connections";

/** Portal-owned token pairs; bridge deployments and availability stay in wallet-config. */
export const tokenRegistry = tokenConnectionsSchema.parse(data);
