import { dispatch } from "@/lib/api/routes";

export const runtime = "nodejs";

async function handle(request: Request, context: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await context.params;
  return dispatch(request, segments);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
