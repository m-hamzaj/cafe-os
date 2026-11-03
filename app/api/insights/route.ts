import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { computeInsightData } from "@/lib/queries/insights";
import { generateInsightSummary } from "@/lib/llm/insights";

export async function GET() {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  // The real numbers are computed and available regardless of whether
  // the AI narration succeeds -- same contract as gig-tax-calculator's
  // API route: a Groq failure only nulls the summary, never the data.
  const data = await computeInsightData();
  const { summary, error } = await generateInsightSummary(data);

  return NextResponse.json({ data, summary, summaryError: error });
}
