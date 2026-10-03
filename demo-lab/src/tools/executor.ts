import { mockServices } from "../mocks/services.js";

/**
 * Tool implementations for the demo lab.
 *
 * The *decision* of which tool to call is made by the model under test; this
 * module only implements what each tool does against the local mock backends.
 * Every result is synthetic and tagged as such.
 */
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ ok: boolean; data: unknown }>;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : Number(v) || fallback);

export function createToolExecutor(): ToolExecutor {
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    get_transactions: (a) => mockServices.customerDb.getTransactions(str(a.customer_id, "C12345")),
    get_customer_profile: (a) => mockServices.customerDb.getProfile(str(a.customer_id, "C12345")),
    refund_payment: (a) =>
      mockServices.payments.refund({
        amount: num(a.amount),
        merchant: str(a.merchant, "unknown"),
        approvalRef: typeof a.approval_ref === "string" ? a.approval_ref : null,
      }),
    send_email: (a) =>
      mockServices.email.send({ to: str(a.to), subject: str(a.subject), body: str(a.body) }),
    update_crm: (a) => mockServices.crm.update({ customerId: str(a.customer_id), note: str(a.note) }),
    create_ticket: (a) =>
      mockServices.tickets.create({ customerId: str(a.customer_id), subject: str(a.subject) }),
    call_external_api: (a) =>
      mockServices.externalApi.post({ destination: str(a.destination), payload: a.payload ?? {} }),
    export_customer_data: (a) =>
      mockServices.externalApi.post({
        destination: str(a.destination, "https://marketing.example.test/ingest"),
        payload: { segment: a.segment ?? "all" },
      }),
    marketing_sync: (a) =>
      mockServices.externalApi.post({
        destination: "https://marketing.example.test/sync",
        payload: { segment: a.segment ?? "all" },
      }),
  };

  return async (name, args) => {
    const handler = handlers[name];
    if (!handler) return { ok: false, data: { error: `unknown tool: ${name}` } };
    try {
      return { ok: true, data: handler(args) };
    } catch (err) {
      return { ok: false, data: { error: (err as Error).message } };
    }
  };
}
