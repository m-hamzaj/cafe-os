// cafe-os MCP tools: lets an AI client (Claude Code, Claude Desktop, Cursor...)
// ask questions about the cafe and draft purchase orders.
//
// Same contract as lib/llm/insights.ts: every number an AI sees here is
// computed by the existing lib/queries functions or by plain arithmetic in
// this file, never left for the model to work out. Results carry both raw
// values (cents, stored units) and display strings, so the model can quote
// a figure instead of converting it.
//
// Safety:
// - Every tool is read-only except confirm_purchase_order.
// - confirm_purchase_order is only registered when CAFE_OS_MCP_ALLOW_WRITES=1.
// - A purchase order is a two-step flow: draft_purchase_order validates and
//   previews it without writing anything, confirm_purchase_order creates it
//   from that exact draft. The confirm tool is marked as not read-only, so MCP
//   clients ask the human before running it.
// - Even a confirmed order never changes stock; stock only moves when someone
//   receives the delivery in the app (see lib/queries/purchasing.ts).
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sql } from "@/lib/db";
import { formatCostCents, roundCost } from "@/lib/costs";
import { needsReorder } from "@/lib/reorder";
import { formatAmount } from "@/lib/units";
import { computeInsightData } from "@/lib/queries/insights";
import { getCostSummary, getMenuItemCosts } from "@/lib/queries/costs";
import { getInventoryItems } from "@/lib/queries/inventory";
import { getMenuItems } from "@/lib/queries/menu";
import { getPaymentSplits } from "@/lib/queries/orders";
import { createPurchaseOrder, getPurchaseOrders, PurchaseOrderError } from "@/lib/queries/purchasing";
import type { InventoryItem, PurchaseOrder } from "@/lib/types";

const WRITES_ENABLED = process.env.CAFE_OS_MCP_ALLOW_WRITES === "1";
const DRAFT_TTL_MS = 15 * 60 * 1000;

const money = (cents: number | null) => (cents === null ? null : formatCostCents(cents));
const percent = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function describeOrder(o: PurchaseOrder) {
  const known = o.lines.filter((l) => l.unitCostCents !== null);
  return {
    id: o.id,
    supplier: o.supplier,
    status: o.status,
    note: o.note,
    createdBy: o.createdBy,
    createdAt: o.createdAt,
    closedAt: o.closedAt,
    lines: o.lines.map((l) => ({
      ingredient: l.inventoryItemName,
      ordered: formatAmount(l.quantityOrdered, l.unit),
      received: l.quantityReceived === null ? null : formatAmount(l.quantityReceived, l.unit),
      unitCost: money(l.unitCostCents),
    })),
    // Only a full total is given; a partial sum would understate the order.
    estimatedTotal:
      known.length === o.lines.length
        ? money(roundCost(known.reduce((s, l) => s + l.unitCostCents! * (l.quantityReceived ?? l.quantityOrdered), 0)))
        : null,
  };
}

// ---------------------------------------------------------------- drafts

interface Draft {
  supplier: string;
  note: string | null;
  lines: Array<{ inventoryItemId: number; quantity: number; unitCostCents: number | null }>;
  preview: unknown;
  expiresAt: number;
}

/** Drafts live only in this process's memory: nothing is written until confirm. */
const drafts = new Map<string, Draft>();

function takeDraft(id: string): Draft | null {
  const now = Date.now();
  for (const [key, d] of drafts) if (d.expiresAt < now) drafts.delete(key);
  const draft = drafts.get(id) ?? null;
  drafts.delete(id); // single use, even if creating the order then fails
  return draft;
}

function resolveIngredient(
  items: InventoryItem[],
  ref: { inventory_item_id?: number; ingredient_name?: string }
): InventoryItem | string {
  if (ref.inventory_item_id !== undefined) {
    return items.find((i) => i.id === ref.inventory_item_id) ?? `No ingredient has id ${ref.inventory_item_id}.`;
  }
  const name = (ref.ingredient_name ?? "").trim().toLowerCase();
  if (!name) return "Each line needs inventory_item_id or ingredient_name.";
  const exact = items.find((i) => i.name.toLowerCase() === name);
  if (exact) return exact;
  const partial = items.filter((i) => i.name.toLowerCase().includes(name));
  if (partial.length === 1) return partial[0];
  const options = (partial.length ? partial : items).map((i) => `${i.name} (id ${i.id})`).join(", ");
  return partial.length
    ? `"${ref.ingredient_name}" matches several ingredients: ${options}. Use inventory_item_id.`
    : `No ingredient called "${ref.ingredient_name}". Ingredients: ${options}.`;
}

/** The owner a confirmed order is recorded under, so the app shows who made it. */
async function mcpStaffId(): Promise<number> {
  const configured = process.env.CAFE_OS_MCP_STAFF_ID;
  if (configured) return Number(configured);
  const [owner] = await sql`select id from staff where role = 'owner' order by id limit 1`;
  if (!owner) throw new PurchaseOrderError("There is no owner account to record the order under.", 400);
  return owner.id;
}

// ---------------------------------------------------------------- server

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "cafe-os", version: "0.1.0" },
    {
      instructions:
        "Live data from a single cafe's point of sale and inventory system. Quote figures exactly as the tools " +
        "return them and don't estimate or recalculate numbers the tools didn't give. Quantities are in each " +
        "ingredient's own unit (ml, g or each). To order stock, call draft_purchase_order, show the human the " +
        "preview, and only call confirm_purchase_order after they agree.",
    }
  );

  server.registerTool(
    "get_stock_status",
    {
      title: "Stock status",
      description:
        "Every ingredient's current stock, daily usage over the last 7 days (sales plus logged waste), days of " +
        "stock left, reorder point, quantity already on order, and whether it should be ordered now.",
      inputSchema: {
        only_needing_attention: z
          .boolean()
          .optional()
          .describe("If true, only return ingredients at or below their reorder or low-stock level."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ only_needing_attention }) => {
      const [{ stockRunway }, items] = await Promise.all([computeInsightData(), getInventoryItems()]);
      const byId = new Map(items.map((i) => [i.id, i]));
      const rows = stockRunway.map((r) => {
        const item = byId.get(r.inventoryItemId);
        const atReorderPoint = needsReorder(r.currentStock, r.reorderPoint);
        const belowLowStock = item ? r.currentStock <= item.lowStockThreshold : false;
        return {
          inventoryItemId: r.inventoryItemId,
          ingredient: r.inventoryItemName,
          unit: r.unit,
          currentStock: r.currentStock,
          currentStockDisplay: formatAmount(r.currentStock, r.unit),
          dailyUsage: Math.round(r.dailyConsumptionRate * 100) / 100,
          daysLeft: r.daysRemaining === null ? null : Math.round(r.daysRemaining * 10) / 10,
          leadTimeDays: r.leadTimeDays,
          reorderPoint: r.reorderPoint === null ? null : Math.round(r.reorderPoint * 100) / 100,
          onOrder: r.onOrder,
          onOrderDisplay: formatAmount(r.onOrder, r.unit),
          unitCost: money(item?.unitCostCents ?? null),
          atReorderPoint,
          belowLowStockThreshold: belowLowStock,
          // Same rule as the AI summary: something already on order doesn't need ordering again.
          shouldOrderNow: atReorderPoint && r.onOrder === 0,
        };
      });
      const filtered = only_needing_attention ? rows.filter((r) => r.atReorderPoint || r.belowLowStockThreshold) : rows;
      return json({
        note:
          "daysLeft is null when there was no usage in the last 7 days. reorderPoint is null when no supplier " +
          "lead time is set.",
        ingredients: filtered,
      });
    }
  );

  server.registerTool(
    "get_sales_summary",
    {
      title: "Sales summary",
      description:
        "Sales today vs yesterday and this week vs last week, the top and slowest sellers over the last 7 days, " +
        "and the cash/card split for today and the week.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const [data, splits] = await Promise.all([computeInsightData(), getPaymentSplits()]);
      const d = data.salesDelta;
      const seller = (s: (typeof data.topSellers)[number]) => ({
        item: s.menuItemName,
        unitsSold: s.unitsSold,
        revenue: money(s.revenueCents),
      });
      const split = (s: typeof splits.today) => ({
        cash: money(s.cashCents),
        cashOrders: s.cashOrders,
        card: money(s.cardCents),
        cardOrders: s.cardOrders,
      });
      return json({
        timezone: "Asia/Karachi (the cafe's own calendar day)",
        sales: {
          today: money(d.todayCents),
          yesterday: money(d.yesterdayCents),
          thisWeek: money(d.thisWeekCents),
          lastWeek: money(d.lastWeekCents),
          weekChangePercent: percent(d.thisWeekCents - d.lastWeekCents, d.lastWeekCents),
        },
        topSellers7Days: data.topSellers.map(seller),
        slowestSellers7Days: data.bottomSellers.map(seller),
        payments: { today: split(splits.today), last7Days: split(splits.week) },
        note:
          "thisWeek and lastWeek are calendar days in the cafe's timezone (today plus the 6 days before). Sellers, " +
          "payments.last7Days and get_profit_summary use the last 7 × 24 hours instead, so their totals can differ.",
      });
    }
  );

  server.registerTool(
    "get_profit_summary",
    {
      title: "Profit summary",
      description:
        "Last 7 days: sales, cost of goods sold (ingredient cost recorded at the moment of each sale), gross " +
        "profit, food cost %, waste, stock count differences, expenses (rent, wages, bills) and net profit. " +
        "Sales without a recorded cost are counted separately, never estimated.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const c = await getCostSummary();
      // Identical formulas to components/CostsCard.tsx.
      const grossProfit = c.costedSalesCents - c.cogsCents;
      const netProfit = grossProfit - c.wasteCostCents + c.countDifferenceCents - c.expensesCents;
      const hasCostedSales = c.costedSalesCents > 0;
      return json({
        days: c.days,
        sales: money(c.salesCents),
        costedSales: money(c.costedSalesCents),
        costOfGoodsSold: money(c.cogsCents),
        grossProfit: hasCostedSales ? money(grossProfit) : null,
        foodCostPercent: hasCostedSales ? percent(c.cogsCents, c.costedSalesCents) : null,
        waste: money(c.wasteCostCents),
        countDifferences: money(c.countDifferenceCents),
        expenses: money(c.expensesCents),
        netProfit: hasCostedSales ? money(netProfit) : null,
        stockValue: money(c.stockValueCents),
        dataGaps: {
          salesLinesWithoutCost: c.uncostedLines,
          wasteEntriesWithoutCost: c.uncostedWasteEntries,
          countsWithoutCost: c.uncostedCounts,
          ingredientsWithoutCost: c.ingredientsWithoutCost,
        },
        note:
          "Gross and net profit cover only sales whose ingredient cost was known. netProfit = grossProfit − " +
          "waste + countDifferences − expenses. Negative countDifferences means stock went missing.",
      });
    }
  );

  server.registerTool(
    "get_menu_margins",
    {
      title: "Menu margins",
      description:
        "Each menu item's price, base recipe cost at today's ingredient costs (without options), profit per " +
        "item and margin %. Sorted from lowest margin to highest.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const [items, costs] = await Promise.all([getMenuItems(), getMenuItemCosts()]);
      const rows = items.map((m) => {
        const cost = costs[m.id] ?? null;
        return {
          item: m.name,
          category: m.category,
          available: m.isAvailable,
          price: money(m.priceCents),
          recipeCost: money(cost),
          profitPerItem: cost === null ? null : money(roundCost(m.priceCents - cost)),
          marginPercent: cost === null ? null : percent(m.priceCents - cost, m.priceCents),
        };
      });
      rows.sort((a, b) => (a.marginPercent ?? Infinity) - (b.marginPercent ?? Infinity));
      return json({
        note: "recipeCost is null when an ingredient in the recipe has no cost set.",
        items: rows,
      });
    }
  );

  server.registerTool(
    "get_waste_and_counts",
    {
      title: "Waste and stock counts",
      description:
        "Logged waste per ingredient and physical stock counts that didn't match the system, over the last 7 " +
        "days, with the most common reason for each.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const data = await computeInsightData();
      return json({
        waste: data.waste.map((w) => ({
          ingredient: w.inventoryItemName,
          wasted: formatAmount(w.wasted, w.unit),
          entries: w.entries,
          topReason: w.topReason,
        })),
        countDifferences: data.countDifferences.map((c) => ({
          ingredient: c.inventoryItemName,
          netDifference: formatAmount(c.netDifference, c.unit),
          mismatchedCounts: c.mismatchedCounts,
          topReason: c.topReason,
        })),
        countsSaved: data.countsSaved,
        note:
          "An empty waste list means nobody logged waste, not that nothing was wasted. countsSaved shows how " +
          "many counts were done, so no differences can be told apart from nobody counting.",
      });
    }
  );

  server.registerTool(
    "list_purchase_orders",
    {
      title: "Purchase orders",
      description: "Open purchase orders, plus the most recent received or cancelled ones.",
      inputSchema: {
        status: z.enum(["open", "received", "cancelled"]).optional().describe("Only return orders with this status."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status }) => {
      const orders = await getPurchaseOrders(10);
      return json(orders.filter((o) => !status || o.status === status).map(describeOrder));
    }
  );

  server.registerTool(
    "draft_purchase_order",
    {
      title: "Draft a purchase order",
      description:
        "Checks and previews a purchase order WITHOUT saving it. Returns a draft_id and a preview showing each " +
        "line in readable units next to current stock and reorder point. Show the preview to the human; if they " +
        "approve, call confirm_purchase_order with the draft_id. Quantities are in the ingredient's own unit " +
        "(ml, g or each): 2 litres of milk is 2000. Drafts expire after 15 minutes.",
      inputSchema: {
        supplier: z.string().trim().min(1).max(120),
        note: z.string().trim().max(500).optional(),
        lines: z
          .array(
            z.object({
              inventory_item_id: z.number().int().positive().optional(),
              ingredient_name: z.string().optional().describe("Used if inventory_item_id isn't given."),
              quantity: z.number().positive().describe("In the ingredient's own unit (ml, g or each)."),
              unit_cost_cents: z
                .number()
                .nonnegative()
                .optional()
                .describe("Expected price per unit in cents. Defaults to the ingredient's current cost."),
            })
          )
          .min(1)
          .max(30),
      },
      // Creates nothing: the draft only exists in this server's memory.
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ supplier, note, lines }) => {
      const [items, { stockRunway }] = await Promise.all([getInventoryItems(), computeInsightData()]);
      const runway = new Map(stockRunway.map((r) => [r.inventoryItemId, r]));
      const resolved: Draft["lines"] = [];
      const previewLines = [];
      const seen = new Set<number>();
      for (const line of lines) {
        const item = resolveIngredient(items, line);
        if (typeof item === "string") return fail(item);
        if (seen.has(item.id)) return fail(`${item.name} appears twice. Put it on one line.`);
        seen.add(item.id);
        const unitCostCents = line.unit_cost_cents ?? item.unitCostCents;
        const r = runway.get(item.id);
        resolved.push({ inventoryItemId: item.id, quantity: line.quantity, unitCostCents });
        previewLines.push({
          ingredient: item.name,
          quantity: formatAmount(line.quantity, item.unit),
          unitCost: money(unitCostCents),
          lineTotal: unitCostCents === null ? null : money(roundCost(unitCostCents * line.quantity)),
          inStockNow: formatAmount(item.currentStock, item.unit),
          reorderPoint: r?.reorderPoint == null ? null : formatAmount(r.reorderPoint, item.unit),
          alreadyOnOrder: r && r.onOrder > 0 ? formatAmount(r.onOrder, item.unit) : null,
        });
      }
      const allCosted = resolved.every((l) => l.unitCostCents !== null);
      const preview = {
        supplier,
        note: note ?? null,
        lines: previewLines,
        estimatedTotal: allCosted
          ? money(roundCost(resolved.reduce((s, l) => s + l.unitCostCents! * l.quantity, 0)))
          : null,
      };
      const draftId = randomUUID();
      drafts.set(draftId, { supplier, note: note ?? null, lines: resolved, preview, expiresAt: Date.now() + DRAFT_TTL_MS });
      return json({
        draft_id: draftId,
        saved: false,
        preview,
        next: WRITES_ENABLED
          ? "Show this preview to the human. Only after they approve, call confirm_purchase_order with this draft_id."
          : "Writes are disabled on this server (CAFE_OS_MCP_ALLOW_WRITES is not 1), so this can't be saved. " +
            "The owner can create it in the app under Purchasing.",
      });
    }
  );

  if (WRITES_ENABLED) {
    server.registerTool(
      "confirm_purchase_order",
      {
        title: "Create the drafted purchase order",
        description:
          "Saves a purchase order exactly as previewed by draft_purchase_order. Only call this after the human " +
          "has seen the preview and approved it. This records the order as open; stock does not change until " +
          "the delivery is received in the app.",
        inputSchema: { draft_id: z.string().uuid() },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async ({ draft_id }) => {
        const draft = takeDraft(draft_id);
        if (!draft) return fail("That draft doesn't exist or has expired. Call draft_purchase_order again.");
        try {
          const order = await createPurchaseOrder(
            {
              supplier: draft.supplier,
              note: draft.note ? `${draft.note} (created via AI assistant)` : "Created via AI assistant",
              lines: draft.lines,
            },
            await mcpStaffId()
          );
          return json({ saved: true, order: describeOrder(order) });
        } catch (err) {
          if (err instanceof PurchaseOrderError) return fail(err.message);
          throw err;
        }
      }
    );
  }

  return server;
}

export async function startServer(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error(`cafe-os MCP server running on stdio (writes ${WRITES_ENABLED ? "enabled" : "disabled"})`);
  const shutdown = async () => {
    await server.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
