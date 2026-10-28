import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config.js";
const client=env.ANTHROPIC_API_KEY?new Anthropic({apiKey:env.ANTHROPIC_API_KEY}):null;
export async function callAnthropic(
  system: string,
  input: string,
  options: { timeoutMs?: number } = {}
) {
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const timeoutMs = Math.max(
    5_000,
    Math.min(options.timeoutMs ?? 90_000, 120_000)
  );

  const message = await client.messages.create(
    {
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: input }]
    },
    {
      timeout: timeoutMs,
      maxRetries: 0
    }
  );

  return message.content
    .filter((x: any) => x.type === "text")
    .map((x: any) => x.text)
    .join("\n");
}
