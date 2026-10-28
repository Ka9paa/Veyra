import { callOpenAI } from "./openai.js";
import { callAnthropic } from "./anthropic.js";
import { env } from "../config.js";

export type ModelLane = "planner" | "code" | "design" | "repair";

export interface ModelRunOptions {
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  timeoutMs?: number;
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

  const timed = async <T>(
    provider: string,
    fn: () => Promise<T>
  ): Promise<T> => {
    const timeoutMs = Math.max(
      5_000,
      Math.min(options.timeoutMs ?? 90_000, 120_000)
    );

    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

        console.error(
          `[V4 MODEL] TIMEOUT ${label} | provider=${provider} | seconds=${seconds} | limit_ms=${timeoutMs}`
        );

        reject(
          new Error(
            `V4 model timeout: ${label} via ${provider} exceeded ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        fn(),
        timeout
      ]);

      console.error(
        `[V4 MODEL] DONE ${label} | provider=${provider} | seconds=${((Date.now() - startedAt) / 1000).toFixed(1)}`
      );

      return result;
    } catch (error) {
      console.error(
        `[V4 MODEL] FAIL ${label} | provider=${provider} | seconds=${((Date.now() - startedAt) / 1000).toFixed(1)}`
      );

      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const isTimeoutError = (error: unknown) => {
    const message =
      error instanceof Error ? error.message : String(error);

    return (
      message.includes("V4 model timeout:") ||
      /timed? ?out/i.test(message) ||
      /timeout/i.test(message)
    );
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
      return await timed("anthropic", () =>
        callAnthropic(system, input, { timeoutMs: options.timeoutMs })
      );
    } catch (anthropicError) {
      if (isTimeoutError(anthropicError)) {
        console.error(
          `[V4 MODEL] NO_FALLBACK ${label} | provider=anthropic | reason=timeout`
        );
        throw anthropicError;
      }

      if (hasOpenAI) {
        return await timed("openai", () =>
          callOpenAI(system, input, options)
        );
      }

      throw anthropicError;
    }
  }

  if (hasOpenAI) {
    try {
      return await timed("openai", () => callOpenAI(system, input, options));
    } catch (openAIError) {
      if (hasAnthropic) {
        return await timed("anthropic", () =>
        callAnthropic(system, input, { timeoutMs: options.timeoutMs })
      );
      }
      throw openAIError;
    }
  }

  return await timed("anthropic", () =>
        callAnthropic(system, input, { timeoutMs: options.timeoutMs })
      );
}
