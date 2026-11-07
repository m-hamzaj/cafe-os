import "server-only";
import { callGroq, type GroqMessage } from "@/lib/llm/groq-client";
import { getCachedInsightSummary, saveInsightSummary, type InsightData } from "@/lib/queries/insights";

// Reopening the dashboard within this window reuses the last summary, which
// caps Groq usage at about four calls an hour. The numbers beside the summary
// are always live, so the panel shows how old the summary is.
const SUMMARY_MAX_AGE_MINUTES = 15;

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Renders the real, already-computed numbers into plain text the model
 * reads as data, never as something to recompute or extend. Same
 * contract as the gig-tax-calculator's AI explanation layer: the LLM
 * narrates, it never invents or recalculates a figure. */
function formatInsightData(data: InsightData): string {
  const lines: string[] = [];

  lines.push("TOP SELLERS (last 7 days):");
  for (const s of data.topSellers) {
    lines.push(`- ${s.menuItemName}: ${s.unitsSold} sold, ${formatCents(s.revenueCents)} revenue`);
  }

  lines.push("\nSLOWEST SELLERS (last 7 days, available items only):");
  for (const s of data.bottomSellers) {
    lines.push(`- ${s.menuItemName}: ${s.unitsSold} sold`);
  }

  lines.push("\nSTOCK RUNWAY:");
  for (const r of data.stockRunway) {
    const runway =
      r.daysRemaining === null
        ? "no recent usage, can't estimate runway"
        : `about ${r.daysRemaining.toFixed(1)} days remaining at the current usage rate (sales plus logged waste)`;
    lines.push(`- ${r.inventoryItemName}: ${r.currentStock.toFixed(1)} ${r.unit} in stock, ${runway}`);
  }

  lines.push("\nSALES:");
  lines.push(`- Today so far: ${formatCents(data.salesDelta.todayCents)}`);
  lines.push(`- Yesterday (full day): ${formatCents(data.salesDelta.yesterdayCents)}`);
  lines.push(`- This week (last 7 days): ${formatCents(data.salesDelta.thisWeekCents)}`);
  lines.push(`- Prior week: ${formatCents(data.salesDelta.lastWeekCents)}`);

  return lines.join("\n");
}

function buildMessages(data: InsightData): GroqMessage[] {
  const system: GroqMessage = {
    role: "system",
    content: [
      "You write a short daily summary for a cafe owner, based ONLY on the real numbers given to you.",
      "Never invent a number, never recompute one, never guess at data you weren't given.",
      "If a stock item has no measurable runway, say so plainly instead of estimating one.",
      "Lead with the single most actionable thing (e.g. a stock item about to run out), then briefly note sales trend and top/slow sellers.",
      "Write 3-5 short sentences, plain English, no headers or bullet points, as if texting the owner a quick update.",
    ].join(" "),
  };
  const user: GroqMessage = {
    role: "user",
    content: `Here is today's data:\n\n${formatInsightData(data)}`,
  };
  return [system, user];
}

export interface InsightSummaryResult {
  summary: string | null;
  /** Whole minutes since the summary was written; null when there is none. */
  ageMinutes: number | null;
  error: string | null;
}

/** Never throws. A Groq failure only means summary is null, exactly like
 * the gig-tax-calculator's explanation layer -- the real computed data
 * (InsightData) is always available to render regardless of whether the
 * narration succeeded. The cache can fail the same way: without it the
 * summary is just written fresh, and failures are never saved, so the next
 * visit tries Groq again. */
export async function generateInsightSummary(data: InsightData): Promise<InsightSummaryResult> {
  try {
    const cached = await getCachedInsightSummary(SUMMARY_MAX_AGE_MINUTES);
    if (cached) {
      return { summary: cached.summary, ageMinutes: cached.ageMinutes, error: null };
    }
  } catch (cacheError) {
    console.error("[insights] could not read the summary cache:", cacheError);
  }

  const outcome = await callGroq(buildMessages(data));
  if (outcome.ok) {
    try {
      await saveInsightSummary(outcome.text);
    } catch (cacheError) {
      console.error("[insights] could not save the summary cache:", cacheError);
    }
    return { summary: outcome.text, ageMinutes: 0, error: null };
  }
  const error =
    outcome.reason === "rate_limited"
      ? "AI summary is temporarily busy -- try again in a minute. Your numbers below are still accurate."
      : "AI summary is unavailable right now. Your numbers below are still accurate.";
  return { summary: null, ageMinutes: null, error };
}
