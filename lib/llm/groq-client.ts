import "server-only";
import Groq, { APIConnectionError, RateLimitError } from "groq-sdk";

/**
 * SERVER-ONLY. The `server-only` import above makes any accidental
 * import of this module from a client component a build-time error, not
 * just a convention -- this is the one file allowed to read
 * GROQ_API_KEY. Never import this from anything under a "use client"
 * boundary.
 *
 * Same client shape as the gig-tax-calculator project's groq-client.ts
 * -- reused deliberately, not reinvented, since that version was already
 * tested against real rate-limit and failure behavior.
 */
const MODEL = "openai/gpt-oss-20b";
// gpt-oss-20b is a reasoning model -- it spends part of this budget on
// hidden chain-of-thought before the visible answer, so this needs more
// headroom than a non-reasoning model's "explain one number" task
// (compare gig-tax-calculator's 400, for a simpler prompt). Too low a
// cap here was observed to occasionally let reasoning consume the whole
// budget, leaving zero tokens for the actual summary -- an empty
// completion, not an error, so it silently looked like "AI unavailable."
const MAX_COMPLETION_TOKENS = 900;
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BASE_BACKOFF_MS = 1_000;
const REQUEST_TIMEOUT_MS = 9_000;

let client: Groq | null = null;

function getClient(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }
  if (!client) {
    client = new Groq({
      apiKey: process.env.GROQ_API_KEY,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0, // explicit retry loop below instead of the SDK's hidden one
    });
  }
  return client;
}

export interface GroqMessage {
  role: "system" | "user";
  content: string;
}

export type GroqOutcome = { ok: true; text: string } | { ok: false; reason: "rate_limited" | "unavailable" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Never throws -- returns a tagged outcome so every call site's fallback
 * path is an unavoidable branch on the return value, not a try/catch
 * someone could forget. A Groq failure must only mean "no AI summary
 * today," never a broken insights page.
 */
export async function callGroq(messages: GroqMessage[]): Promise<GroqOutcome> {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    try {
      const groq = getClient();
      const response = await groq.chat.completions.create({
        model: MODEL,
        messages,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        temperature: 0.3,
      });
      const text = response.choices[0]?.message?.content?.trim();
      if (!text) {
        console.error(
          "[groq-client] empty completion, finish_reason:",
          response.choices[0]?.finish_reason,
          "usage:",
          response.usage
        );
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, text };
    } catch (error) {
      const isTransient = error instanceof RateLimitError || error instanceof APIConnectionError;
      if (!isTransient || attempt === RATE_LIMIT_RETRIES) {
        return {
          ok: false,
          reason: error instanceof RateLimitError ? "rate_limited" : "unavailable",
        };
      }
      await sleep(RATE_LIMIT_BASE_BACKOFF_MS * (attempt + 1));
    }
  }
  return { ok: false, reason: "unavailable" };
}
