import "server-only";
import { sql } from "@/lib/db";
import { CAFE_TIMEZONE } from "@/lib/time";
import type { Expense, ExpenseFrequency } from "@/lib/types";

/** Thrown for expense requests that can't be carried out, with an HTTP status. */
export class ExpenseError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/**
 * Every expense, with the share of it that falls in the last `days` days
 * (today and the days before it, on the cafe's calendar):
 * - once: the whole amount if it was paid in that range, otherwise nothing;
 * - weekly: amount ÷ 7 for each day it covers in the range;
 * - monthly: amount × 12 ÷ 365 for each day it covers in the range.
 * The range is whole days, so it can differ slightly from the rolling 7 × 24
 * hours used for sales.
 */
export async function getExpenses(days: number): Promise<Expense[]> {
  const rows = await sql`
    with range as (
      select (now() at time zone ${CAFE_TIMEZONE})::date as last_day,
             (now() at time zone ${CAFE_TIMEZONE})::date - (${days}::integer - 1) as first_day
    )
    select e.id, e.name, e.amount_cents, e.frequency, e.starts_on::text as starts_on, e.ends_on::text as ends_on,
           e.created_at, s.name as created_by,
           case e.frequency
             when 'once' then case when e.starts_on between r.first_day and r.last_day then e.amount_cents else 0 end
             else e.amount_cents
                  * (case e.frequency when 'weekly' then 1.0 / 7 else 12.0 / 365 end)
                  * greatest(0, least(coalesce(e.ends_on, r.last_day), r.last_day) - greatest(e.starts_on, r.first_day) + 1)
           end as range_cents,
           (e.frequency <> 'once' and (e.ends_on is null or e.ends_on > r.last_day)) as running
    from expenses e
    cross join range r
    left join staff s on s.id = e.created_by
    order by running desc, e.starts_on desc, e.id desc
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    amountCents: r.amount_cents,
    frequency: r.frequency as ExpenseFrequency,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by,
    rangeCents: Math.round(Number(r.range_cents)),
    running: r.running,
  }));
}

export async function createExpense(
  input: { name: string; amountCents: number; frequency: ExpenseFrequency; startsOn: string },
  staffId: number
): Promise<number> {
  const [row] = await sql`
    insert into expenses (name, amount_cents, frequency, starts_on, ends_on, created_by)
    values (${input.name}, ${input.amountCents}, ${input.frequency}, ${input.startsOn},
            ${input.frequency === "once" ? input.startsOn : null}, ${staffId})
    returning id
  `;
  return row.id;
}

/** Stops a weekly or monthly expense after today (it still counts today). */
export async function stopExpense(id: number): Promise<void> {
  const [row] = await sql`
    update expenses
    set ends_on = greatest(starts_on, (now() at time zone ${CAFE_TIMEZONE})::date)
    where id = ${id} and frequency <> 'once'
      and (ends_on is null or ends_on > (now() at time zone ${CAFE_TIMEZONE})::date)
    returning id
  `;
  if (!row) throw new ExpenseError("That expense isn't running.", 404);
}

/** Removes an expense entered by mistake. */
export async function deleteExpense(id: number): Promise<void> {
  const [row] = await sql`delete from expenses where id = ${id} returning id`;
  if (!row) throw new ExpenseError("That expense doesn't exist.", 404);
}
