import { handleNearRequest } from "../../../../../bridge/providers/near/api.server";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleNearRequest(request, "deposit");
