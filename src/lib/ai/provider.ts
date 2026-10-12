import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_MODEL =
  process.env.VEYRA_AGENT_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-5.6-sol";

export interface JSONGenerationOptions<TSchema extends z.ZodTypeAny> {
  system: string;
  prompt: string;
  schema: TSchema;
  model?: string;
  temperature?: number;
}

function extractJSONObject(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("AI provider returned no valid JSON object.");
}

export async function generateJSON<TSchema extends z.ZodTypeAny>(
  options: JSONGenerationOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const result = await generateText({
    model: openai(options.model || DEFAULT_MODEL),
    system: options.system,
    prompt: options.prompt,
    temperature: options.temperature ?? 0.2,
  });

  const parsed = extractJSONObject(result.text);
  return options.schema.parse(parsed);
}
