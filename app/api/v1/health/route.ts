import { apiContracts } from "@/shared/contracts/api";

export const runtime = "nodejs";

export function GET() {
  return Response.json(apiContracts.health.response.parse({ data: { status: "ok" } }), {
    headers: { "Cache-Control": "no-store" },
  });
}
