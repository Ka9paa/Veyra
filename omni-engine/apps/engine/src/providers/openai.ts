import {
  guardModelCall,
  guardGeneratedVisual,
  type VeyraCostStage
} from "../runtime/cost-guard.js";
import OpenAI from "openai";
import { env } from "../config.js";

const client = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;

export interface OpenAICallOptions {
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  costStage?: VeyraCostStage;
  timeoutMs?: number;
}

export async function callOpenAI(
  instructions: string,
  input: string,
  options: OpenAICallOptions = {}
) {
  if (!client) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  guardModelCall(options.costStage ?? "builder");

  const timeoutMs = Math.max(
    5_000,
    Math.min(options.timeoutMs ?? 90_000, 240_000)
  );

  const response = await client.responses.create(
    {
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
    },
    {
      timeout: timeoutMs,
      maxRetries: 0
    }
  );

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

  guardModelCall(options.costStage ?? "visual");

  const timeoutMs = Math.max(
    5_000,
    Math.min(options.timeoutMs ?? 55_000, 90_000)
  );

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
  }, {
    timeout: timeoutMs,
    maxRetries: 0
  });

  const output = response.output_text ?? "";

  if (!output.trim()) {
    throw new Error(
      `Visual review returned no text. model=${env.OPENAI_MODEL} status=${response.status ?? "unknown"}`
    );
  }

  return output;
}


export interface VeyraVisualGenerationOptions {
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  quality?: "low" | "medium" | "high";
}

export interface VeyraGeneratedVisual {
  model: string;
  mimeType: "image/png";
  data: string;
  dataUrl: string;
}

export async function generateVeyraVisual(
  prompt: string,
  options: VeyraVisualGenerationOptions = {}
): Promise<VeyraGeneratedVisual> {
  if (!client) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const cleanPrompt = prompt.trim();

  if (!cleanPrompt) {
    throw new Error("Image generation prompt is empty.");
  }

  guardGeneratedVisual();

  const response = await client.images.generate({
    model: env.OPENAI_IMAGE_MODEL,
    prompt: cleanPrompt,
    size: options.size ?? "1536x1024",
    quality: options.quality ?? "medium",
    output_format: "png"
  });

  const imageBase64 = response.data?.[0]?.b64_json;

  if (!imageBase64) {
    throw new Error(
      `OpenAI image generation returned no image. model=${env.OPENAI_IMAGE_MODEL}`
    );
  }

  const dataUrl = `data:image/png;base64,${imageBase64}`;

  return {
    model: env.OPENAI_IMAGE_MODEL,
    mimeType: "image/png",
    data: imageBase64,
    dataUrl
  };
}
