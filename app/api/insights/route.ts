import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { computeInsightData } from "@/lib/queries/insights";
import { getCostSummary } from "@/lib/queries/costs";
import { generateInsightSummary } from "@/lib/llm/insights";

export async function GET() {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  // The real numbers are computed and available regardless of whether
  // the AI narration succeeds -- same contract as gig-tax-calculator's
  // API route: a Groq failure only nulls the summary, never the data.
  const [data, costs] = await Promise.all([computeInsightData(), getCostSummary()]);
  const { summary, ageMinutes, error } = await generateInsightSummary(data);

  return NextResponse.json({ data, costs, summary, summaryAgeMinutes: ageMinutes, summaryError: error });
}
