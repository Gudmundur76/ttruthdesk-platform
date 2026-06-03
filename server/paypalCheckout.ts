/**
 * paypalCheckout.ts
 *
 * PayPal Orders v2 API integration.
 * - createPayPalOrder: creates a PayPal order for a given plan tier
 * - capturePayPalOrder: captures payment and activates the subscription
 * - getActiveSubscription: returns the user's current active subscription
 * - checkAuditLimitPayPal: enforces per-plan audit quotas
 */

import { ENV } from "./_core/env";
import {
  userSubscriptions,
  UserSubscription,
  InsertUserSubscription,
} from "../drizzle/schema";
import { getDb } from "./db";
import { eq, and, desc } from "drizzle-orm";

// ─── Plan Definitions ─────────────────────────────────────────────────────────
export const PLANS = {
  starter: {
    label: "Starter",
    amountUsd: 150000,   // $1,500.00 in cents
    auditsLimit: 5,
    description: "5 full-depth audits · PDF reports · PDB verification",
  },
  diligence: {
    label: "Diligence",
    amountUsd: 500000,   // $5,000.00 in cents
    auditsLimit: 25,
    description: "25 audits · Priority queue · Knowledge graph access",
  },
  platform: {
    label: "Platform Pilot",
    amountUsd: 1500000,  // $15,000.00 in cents
    auditsLimit: -1,     // unlimited
    description: "Unlimited audits · API access · Dedicated support",
  },
} as const;

export type PlanTier = keyof typeof PLANS;

// ─── PayPal API Helpers ───────────────────────────────────────────────────────
async function getPayPalAccessToken(): Promise<string> {
  const clientId = ENV.paypalClientId;
  const secret = ENV.paypalSecret;
  if (!clientId || !secret) throw new Error("PayPal credentials not configured");

  const base = ENV.paypalMode === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal token error: ${err}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function getPayPalBase(): string {
  return ENV.paypalMode === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

// ─── Create Order ─────────────────────────────────────────────────────────────
export async function createPayPalOrder(
  planTier: PlanTier,
  userId: number,
  returnUrl: string,
  cancelUrl: string
): Promise<{ orderId: string; approveUrl: string }> {
  const plan = PLANS[planTier];
  const token = await getPayPalAccessToken();
  const base = getPayPalBase();

  const amountStr = (plan.amountUsd / 100).toFixed(2);

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: `user_${userId}_${planTier}`,
        description: `Protein Truth Desk — ${plan.label}`,
        amount: {
          currency_code: "USD",
          value: amountStr,
        },
        custom_id: `${userId}:${planTier}`,
      },
    ],
    application_context: {
      brand_name: "Protein Truth Desk",
      landing_page: "BILLING",
      user_action: "PAY_NOW",
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  };

  const res = await fetch(`${base}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal createOrder error: ${err}`);
  }

  const data = await res.json() as {
    id: string;
    links: Array<{ rel: string; href: string }>;
  };

  const approveLink = data.links.find((l) => l.rel === "approve");
  if (!approveLink) throw new Error("No approve link in PayPal response");

  // Persist pending subscription record
  const db = await getDb();
  if (db) {
    await db.insert(userSubscriptions).values({
      userId,
      paypalOrderId: data.id,
      planTier,
      status: "pending",
      auditsLimit: plan.auditsLimit,
      auditsUsed: 0,
      amountUsd: plan.amountUsd,
      currency: "USD",
    } as InsertUserSubscription);
  }

  return { orderId: data.id, approveUrl: approveLink.href };
}

// ─── Capture Order ────────────────────────────────────────────────────────────
export async function capturePayPalOrder(
  orderId: string,
  userId: number
): Promise<UserSubscription> {
  const token = await getPayPalAccessToken();
  const base = getPayPalBase();

  const res = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal captureOrder error: ${err}`);
  }

  const data = await res.json() as {
    status: string;
    purchase_units: Array<{
      payments: {
        captures: Array<{ id: string }>;
      };
    }>;
  };

  if (data.status !== "COMPLETED") {
    throw new Error(`PayPal order not completed: ${data.status}`);
  }

  const captureId = data.purchase_units?.[0]?.payments?.captures?.[0]?.id;

  // Activate subscription
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  await db
    .update(userSubscriptions)
    .set({
      status: "active",
      paypalCaptureId: captureId ?? null,
      activatedAt: new Date(),
    })
    .where(
      and(
        eq(userSubscriptions.paypalOrderId, orderId),
        eq(userSubscriptions.userId, userId)
      )
    );

  const rows = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.paypalOrderId, orderId))
    .limit(1);

  if (!rows[0]) throw new Error("Subscription not found after capture");
  return rows[0];
}

// ─── Get Active Subscription ──────────────────────────────────────────────────
export async function getActiveSubscription(
  userId: number
): Promise<UserSubscription | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(userSubscriptions)
    .where(
      and(
        eq(userSubscriptions.userId, userId),
        eq(userSubscriptions.status, "active")
      )
    )
    .orderBy(desc(userSubscriptions.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Audit Limit Check ────────────────────────────────────────────────────────
export interface AuditLimitResult {
  allowed: boolean;
  reason?: string;
  remaining?: number;
  tier?: PlanTier;
}

export async function checkPayPalAuditLimit(
  userId: number
): Promise<AuditLimitResult> {
  const sub = await getActiveSubscription(userId);
  if (!sub) {
    return {
      allowed: false,
      reason: "No active subscription. Please purchase a plan to submit audits.",
    };
  }
  if (sub.auditsLimit === -1) {
    return { allowed: true, remaining: -1, tier: sub.planTier };
  }
  const remaining = sub.auditsLimit - sub.auditsUsed;
  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `You have used all ${sub.auditsLimit} audits in your ${sub.planTier} plan. Please upgrade to continue.`,
      remaining: 0,
      tier: sub.planTier,
    };
  }
  return { allowed: true, remaining, tier: sub.planTier };
}

// ─── Increment Audit Usage ────────────────────────────────────────────────────
export async function incrementPayPalAuditUsage(userId: number): Promise<void> {
  const sub = await getActiveSubscription(userId);
  if (!sub || sub.auditsLimit === -1) return; // unlimited or no sub — skip
  const db = await getDb();
  if (!db) return;
  await db
    .update(userSubscriptions)
    .set({ auditsUsed: sub.auditsUsed + 1 })
    .where(eq(userSubscriptions.id, sub.id));
}
