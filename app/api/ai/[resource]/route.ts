import { aiRoute } from "../../../../lib/ai/server";
export const dynamic = "force-dynamic";
const handle = (request: Request) => aiRoute(request, new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "");
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
