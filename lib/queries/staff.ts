import "server-only";
import { sql } from "@/lib/db";

export interface StaffSummary {
  id: number;
  name: string;
  role: "owner" | "cashier";
}

/** Names/roles only, safe to send to the client for the login
 * "who are you" picker -- never includes pin_hash. */
export async function listStaffSummaries(): Promise<StaffSummary[]> {
  const rows = await sql`select id, name, role from staff order by role, name`;
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role }));
}

export async function getStaffPinHash(staffId: number): Promise<{ pinHash: string; name: string; role: "owner" | "cashier" } | null> {
  const [row] = await sql`select pin_hash, name, role from staff where id = ${staffId}`;
  if (!row) return null;
  return { pinHash: row.pin_hash, name: row.name, role: row.role };
}

export async function createStaff(input: {
  name: string;
  role: "owner" | "cashier";
  pinHash: string;
}): Promise<void> {
  await sql`
    insert into staff (name, role, pin_hash)
    values (${input.name}, ${input.role}, ${input.pinHash})
  `;
}
