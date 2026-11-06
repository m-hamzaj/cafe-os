import { z } from "zod";

export const loginSchema = z.object({
  staffId: z.number().int().positive(),
  pin: z.string().min(4).max(8),
});

export const orderLineSchema = z.object({
  menuItemId: z.number().int().positive(),
  quantity: z.number().int().positive().max(50),
  optionIds: z.array(z.number().int().positive()).max(50).default([]),
});

export const createOrderSchema = z.object({
  lines: z.array(orderLineSchema).min(1),
  paymentMethod: z.enum(["cash", "card"]),
});

export const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(40),
  priceCents: z.number().int().min(0).max(10_000_00), // sanity ceiling, not a real price limit
  isAvailable: z.boolean(),
});

export const recipeLineSchema = z.object({
  inventoryItemId: z.number().int().positive(),
  quantityUsed: z.number().positive(),
});

const optionAdjustmentSchema = z.object({
  inventoryItemId: z.number().int().positive(),
  quantityDelta: z.number().refine((n) => n !== 0, "An ingredient adjustment can't be zero."),
});

const menuOptionSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Every option needs a name.").max(60),
  priceDeltaCents: z.number().int().min(-10_000_00).max(10_000_00),
  // Left out when the owner didn't change it, so saving the editor can't undo
  // a switch a cashier flipped while it was open.
  isAvailable: z.boolean().optional(),
  adjustments: z
    .array(optionAdjustmentSchema)
    .refine(
      (lines) => new Set(lines.map((l) => l.inventoryItemId)).size === lines.length,
      "An option can only adjust each ingredient once."
    ),
});

export const optionAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
  acrossMenu: z.boolean().default(false),
});

export const optionGroupSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Every option group needs a name.").max(60),
  isRequired: z.boolean(),
  allowsMultiple: z.boolean(),
  options: z.array(menuOptionSchema).min(1, "Every option group needs at least one option."),
});

export const inventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  unit: z.string().trim().min(1).max(20),
  lowStockThreshold: z.number().min(0),
});

export const addStockSchema = z.object({
  inventoryItemId: z.number().int().positive(),
  quantityAdded: z.number().positive(),
});
