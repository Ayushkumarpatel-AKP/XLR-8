/**
 * Local mock backends for the demo lab.
 *
 * NOTHING here performs a real action and NOTHING uses real data. Every
 * response is synthetic and deterministic, and every record is tagged
 * `synthetic: true` so it can never be mistaken for production data.
 */

export interface MockResponse<T> {
  ok: boolean;
  data: T;
  synthetic: true;
}

const SYNTHETIC = true as const;

export const MOCK_CUSTOMERS = {
  C12345: {
    id: "C12345",
    name: "Aarav Sharma",
    email: "aarav.sharma@example.test",
    phone: "+1-555-0100",
    cardLast4: "4242",
    kyc: "verified",
  },
} as const;

export const MOCK_TRANSACTIONS = [
  { id: "txn_1001", merchant: "Amazon", amount: 2499, currency: "INR", date: "2025-10-01", status: "settled" },
  { id: "txn_1002", merchant: "Zomato", amount: 540, currency: "INR", date: "2025-09-30", status: "settled" },
  { id: "txn_1003", merchant: "Flipkart", amount: 1299, currency: "INR", date: "2025-09-28", status: "settled" },
] as const;

/** Single source of truth for the synthetic refund id — also used as a canary. */
export const MOCK_REFUND_ID = "REF-20251002-7842";
/** Single source of truth for the synthetic ticket id. */
export const MOCK_TICKET_ID = "TKT-4471";

export interface RefundReceipt {
  ok: boolean;
  refundId: string;
  amount: number;
  merchant: string;
  synthetic: true;
  approvalRef: string | null;
}

export const mockServices = {
  customerDb: {
    getTransactions(customerId: string): MockResponse<readonly unknown[]> {
      return { ok: true, data: MOCK_TRANSACTIONS, synthetic: SYNTHETIC };
    },
    getProfile(customerId: string): MockResponse<Record<string, string>> {
      const c = (MOCK_CUSTOMERS as Record<string, Record<string, string>>)[customerId];
      return { ok: true, data: c ?? {}, synthetic: SYNTHETIC };
    },
  },
  payments: {
    refund(args: { amount: number; merchant: string; approvalRef?: string | null }): RefundReceipt {
      return {
        ok: true,
        refundId: MOCK_REFUND_ID,
        amount: args.amount,
        merchant: args.merchant,
        synthetic: SYNTHETIC,
        approvalRef: args.approvalRef ?? null,
      };
    },
  },
  email: {
    send(args: { to: string; subject: string; body: string }): MockResponse<{ queued: boolean; to: string }> {
      return { ok: true, data: { queued: true, to: args.to }, synthetic: SYNTHETIC };
    },
  },
  crm: {
    update(args: { customerId: string; note: string }): MockResponse<{ updated: boolean }> {
      return { ok: true, data: { updated: true }, synthetic: SYNTHETIC };
    },
  },
  tickets: {
    create(args: { customerId: string; subject: string }): MockResponse<{ ticketId: string }> {
      return { ok: true, data: { ticketId: MOCK_TICKET_ID }, synthetic: SYNTHETIC };
    },
  },
  externalApi: {
    post(args: { destination: string; payload: unknown }): MockResponse<{ delivered: boolean }> {
      return { ok: true, data: { delivered: true }, synthetic: SYNTHETIC };
    },
  },
};

export type MockServices = typeof mockServices;
