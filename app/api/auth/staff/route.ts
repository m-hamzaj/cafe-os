import { NextResponse } from "next/server";
import { listStaffSummaries } from "@/lib/queries/staff";

/** Public -- names/roles only, used by the login screen's "who are you"
 * picker. No PIN data is ever included (see listStaffSummaries). */
export async function GET() {
  const staff = await listStaffSummaries();
  return NextResponse.json({ staff });
}
