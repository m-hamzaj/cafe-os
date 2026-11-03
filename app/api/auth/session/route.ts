import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/** Lets client components check "am I logged in, as whom" without
 * threading session state through every page. */
export async function GET() {
  const session = await getSession();
  return NextResponse.json({ session });
}
