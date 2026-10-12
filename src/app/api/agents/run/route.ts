import { AgentRunRequestSchema, type CoordinatorEvent } from "@/lib/agents/types";
import { coordinateAgents } from "@/lib/agents/coordinator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeSSE(event: CoordinatorEvent): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = AgentRunRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "Invalid agent run request.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const send = async (event: CoordinatorEvent) => {
        if (closed) return;
        controller.enqueue(encodeSSE(event));
      };

      try {
        await coordinateAgents(parsed.data, send);
      } catch (error) {
        await send({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unknown multi-agent execution error.",
        });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
