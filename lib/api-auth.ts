import "server-only";
import { NextResponse } from "next/server";
import { getSession, type Session } from "@/lib/auth";

export type AuthResult = { session: Session; response?: never } | { session?: never; response: NextResponse };

/** Call at the top of any API route that needs a logged-in staff member.
 * Pass `requireOwner: true` for routes only the owner role may use
 * (menu/inventory editing). Usage:
 *
 *   const auth = await requireSession();
 *   if (auth.response) return auth.response;
 *   const { session } = auth;
 */
export async function requireSession(opts?: { requireOwner?: boolean }): Promise<AuthResult> {
  const session = await getSession();
  if (!session) {
    return { response: NextResponse.json({ error: "Not logged in." }, { status: 401 }) };
  }
  if (opts?.requireOwner && session.role !== "owner") {
    return { response: NextResponse.json({ error: "Owner access required." }, { status: 403 }) };
  }
  return { session };
}
