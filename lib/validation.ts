import { z } from "zod";

export const loginSchema = z.object({
  staffId: z.number().int().positive(),
  pin: z.string().min(4).max(8),
});

export const orderLineSchema = z.object({
  menuItemId: z.number().int().positive(),
  quantity: z.number().int().positive().max(50),
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

export const inventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  unit: z.string().trim().min(1).max(20),
  lowStockThreshold: z.number().min(0),
});

export const addStockSchema = z.object({
  inventoryItemId: z.number().int().positive(),
  quantityAdded: z.number().positive(),
});
