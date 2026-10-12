import { callOpenAI } from "./openai.js";
import { callAnthropic } from "./anthropic.js";
import { env } from "../config.js";

export type ModelLane = "planner" | "code" | "design" | "repair";

export interface ModelRunOptions {
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export async function runModel(
  lane: ModelLane,
  system: string,
  input: string,
  options: ModelRunOptions = {}
) {
  const startedAt = Date.now();
  const label =
    system.includes("Design DNA Director") ? "design-dna" :
    system.includes("Principal Composition Architect") ? "composition" :
    system.includes("ASSET") ? "assets" :
    lane === "code" ? "builder" :
    lane === "repair" ? "repair" :
    lane;

  console.error(
    `[V4 MODEL] START ${label} | lane=${lane} | max_tokens=${options.maxOutputTokens ?? "default"}`
  );

  const timed = async <T>(provider: string, fn: () => Promise<T>): Promise<T> => {
    try {
      const result = await fn();
      console.error(
        `[V4 MODEL] DONE ${label} | provider=${provider} | seconds=${((Date.now() - startedAt) / 1000).toFixed(1)}`
      );
      return result;
    } catch (error) {
      console.error(
        `[V4 MODEL] FAIL ${label} | provider=${provider} | seconds=${((Date.now() - startedAt) / 1000).toFixed(1)}`
      );
      throw error;
    }
  };

  const hasOpenAI = Boolean(env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);

  if (!hasOpenAI && !hasAnthropic) {
    throw new Error(
      "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY."
    );
  }

  if (lane === "design" && hasAnthropic) {
    try {
      return await timed("anthropic", () => callAnthropic(system, input));
    } catch (anthropicError) {
      if (hasOpenAI) {
        return await timed("openai", () => callOpenAI(system, input, options));
      }
      throw anthropicError;
    }
  }

  if (hasOpenAI) {
    try {
      return await timed("openai", () => callOpenAI(system, input, options));
    } catch (openAIError) {
      if (hasAnthropic) {
        return await timed("anthropic", () => callAnthropic(system, input));
      }
      throw openAIError;
    }
  }

  return await timed("anthropic", () => callAnthropic(system, input));
}
