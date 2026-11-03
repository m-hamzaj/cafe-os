import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation";
import { getStaffPinHash } from "@/lib/queries/staff";
import { verifyPin, createSession } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your PIN." }, { status: 400 });
  }

  const staff = await getStaffPinHash(parsed.data.staffId);
  // Same generic error whether the staff ID is unknown or the PIN is
  // wrong -- never confirm to a client which staff IDs exist.
  if (!staff) {
    return NextResponse.json({ error: "Incorrect PIN." }, { status: 401 });
  }

  const valid = await verifyPin(parsed.data.pin, staff.pinHash);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect PIN." }, { status: 401 });
  }

  await createSession({ staffId: parsed.data.staffId, role: staff.role, name: staff.name });
  return NextResponse.json({ name: staff.name, role: staff.role });
}
