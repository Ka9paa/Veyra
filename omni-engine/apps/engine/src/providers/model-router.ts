import { callOpenAI } from "./openai.js";
import { callAnthropic } from "./anthropic.js";
import { env } from "../config.js";

export type ModelLane = "planner" | "code" | "design" | "repair";

export interface ModelRunOptions {
  maxOutputTokens?: number;
}

export async function runModel(
  lane: ModelLane,
  system: string,
  input: string,
  options: ModelRunOptions = {}
) {
  const hasOpenAI = Boolean(env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);

  if (!hasOpenAI && !hasAnthropic) {
    throw new Error(
      "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY."
    );
  }

  if (lane === "design" && hasAnthropic) {
    try {
      return await callAnthropic(system, input);
    } catch (anthropicError) {
      if (hasOpenAI) {
        return await callOpenAI(system, input, options);
      }
      throw anthropicError;
    }
  }

  if (hasOpenAI) {
    try {
      return await callOpenAI(system, input, options);
    } catch (openAIError) {
      if (hasAnthropic) {
        return await callAnthropic(system, input);
      }
      throw openAIError;
    }
  }

  return await callAnthropic(system, input);
}
