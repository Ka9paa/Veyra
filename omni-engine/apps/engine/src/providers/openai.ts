import OpenAI from "openai";
import { env } from "../config.js";

const client = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;

export interface OpenAICallOptions {
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export async function callOpenAI(
  instructions: string,
  input: string,
  options: OpenAICallOptions = {}
) {
  if (!client) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await client.responses.create({
    model: env.OPENAI_MODEL,
    instructions,
    input,
    store: false,
    max_output_tokens: options.maxOutputTokens ?? 32000,
    reasoning: {
      effort: options.reasoningEffort ?? "high"
    },
    text: {
      format: {
        type: "text"
      }
    }
  });

  const output = response.output_text ?? "";

  if (!output.trim()) {
    throw new Error(
      `OpenAI returned no text. model=${env.OPENAI_MODEL} status=${response.status ?? "unknown"}`
    );
  }

  return output;
}

export async function callOpenAIVisual(
  instructions: string,
  input: string,
  screenshotBase64: string,
  options: OpenAICallOptions = {}
) {
  if (!client) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await client.responses.create({
    model: env.OPENAI_MODEL,
    instructions,
    store: false,
    max_output_tokens: options.maxOutputTokens ?? 12000,
    reasoning: {
      effort: options.reasoningEffort ?? "high"
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: input
          },
          {
            type: "input_image",
            image_url: screenshotBase64.startsWith("data:image/")
              ? screenshotBase64
              : `data:image/png;base64,${screenshotBase64}`,
            detail: "high"
          }
        ]
      }
    ]
  });

  const output = response.output_text ?? "";

  if (!output.trim()) {
    throw new Error(
      `Visual review returned no text. model=${env.OPENAI_MODEL} status=${response.status ?? "unknown"}`
    );
  }

  return output;
}
