import type { MissionEvent, Severity } from "@agentguard/contracts";
import { newId, nowIso } from "@agentguard/contracts";
import type { AgentGuardEngine } from "@agentguard/core";

/* ------------------------------------------------------------------ *
 * Alerts & notification delivery.
 *
 * The service subscribes to the *same* event bus everything else uses, so a
 * demo scenario and an interactive session both raise alerts. Channels are
 * dispatched for real; a channel that is not configured reports that honestly
 * rather than pretending to have delivered.
 * ------------------------------------------------------------------ */

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Events that are worth interrupting a human for. */
const WATCHED: Record<string, string> = {
  "finding.created": "finding",
  "policy.violation": "policy",
  "drift.detected": "drift",
  "graph.chain_detected": "chain",
  "mission.failed": "mission",
};

export interface ChannelResult {
  channel: "in-app" | "webhook" | "email";
  ok: boolean;
  detail: string;
}

export interface Alert {
  id: string;
  createdAt: string;
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  missionId: string;
  actorId: string;
  channels: ChannelResult[];
  read: boolean;
}

export interface NotificationSettings {
  /** Only alert at or above this severity. */
  minimumSeverity: Severity;
  inApp: boolean;
  webhook: { enabled: boolean; url: string };
  email: { enabled: boolean; to: string };
}

export interface ChannelStatus {
  channel: string;
  configured: boolean;
  detail: string;
}

export class AlertService {
  private readonly alerts: Alert[] = [];
  private settings: NotificationSettings = {
    minimumSeverity: "high",
    inApp: true,
    webhook: { enabled: true, url: process.env.ALERT_WEBHOOK_URL ?? "" },
    email: { enabled: true, to: process.env.ALERT_EMAIL_TO ?? "" },
  };
  private readonly unsubscribe: () => void;
  private readonly listeners = new Set<(a: Alert) => void>();

  constructor(private readonly engine: AgentGuardEngine, private readonly limit = 200) {
    this.unsubscribe = engine.bus.subscribe((event) => this.onEvent(event));
  }

  dispose(): void {
    this.unsubscribe();
  }

  list(): Alert[] {
    return [...this.alerts].reverse();
  }

  clear(): void {
    this.alerts.length = 0;
  }

  markRead(id?: string): void {
    for (const a of this.alerts) {
      if (!id || a.id === id) a.read = true;
    }
  }

  unreadCount(): number {
    return this.alerts.filter((a) => !a.read).length;
  }

  getSettings(): NotificationSettings {
    return structuredClone(this.settings);
  }

  updateSettings(patch: Partial<NotificationSettings>): NotificationSettings {
    this.settings = {
      ...this.settings,
      ...patch,
      webhook: { ...this.settings.webhook, ...(patch.webhook ?? {}) },
      email: { ...this.settings.email, ...(patch.email ?? {}) },
    };
    return this.getSettings();
  }

  subscribe(listener: (a: Alert) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Which channels are actually usable right now. */
  status(): ChannelStatus[] {
    return [
      { channel: "in-app", configured: true, detail: "always available" },
      {
        channel: "webhook",
        configured: Boolean(this.settings.webhook.url),
        detail: this.settings.webhook.url || "set ALERT_WEBHOOK_URL or configure it in Settings",
      },
      {
        channel: "email",
        configured: this.emailConfigured(),
        detail: this.emailConfigured()
          ? `Gmail SMTP as ${process.env.GMAIL_USER}`
          : "set GMAIL_USER + GMAIL_APP_PASSWORD (Gmail app password) to enable",
      },
    ];
  }

  private emailConfigured(): boolean {
    return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  }

  /** Send a synthetic alert through every enabled channel and report the outcome. */
  async test(): Promise<{ alert: Alert; channels: ChannelResult[] }> {
    const alert: Alert = {
      id: newId("alert"),
      createdAt: nowIso(),
      kind: "test",
      severity: "high",
      title: "Test alert from AgentGuard X",
      detail: "If you can read this, this channel is wired up correctly.",
      missionId: "n/a",
      actorId: "system",
      channels: [],
      read: true,
    };
    const channels = await this.dispatch(alert, true);
    return { alert: { ...alert, channels }, channels };
  }

  private onEvent(event: MissionEvent): void {
    const kind = WATCHED[event.type];
    if (!kind) return;
    if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[this.settings.minimumSeverity]) return;

    const alert: Alert = {
      id: newId("alert"),
      createdAt: nowIso(),
      kind,
      severity: event.severity,
      title: event.message,
      detail: `${event.actorId} · ${event.type}`,
      missionId: event.missionId,
      actorId: event.actorId,
      channels: [],
      read: false,
    };

    this.alerts.push(alert);
    if (this.alerts.length > this.limit) this.alerts.shift();
    for (const listener of this.listeners) {
      try {
        listener(alert);
      } catch {
        /* a broken subscriber must not break the mission */
      }
    }
    void this.dispatch(alert, false);
  }

  private async dispatch(alert: Alert, isTest: boolean): Promise<ChannelResult[]> {
    if (!this.settings.inApp && !isTest) return [];

    const results: ChannelResult[] = [
      { channel: "in-app", ok: true, detail: isTest ? "delivered to the in-app feed" : "added to the alert feed" },
    ];

    if (this.settings.webhook.enabled || isTest) {
      if (!this.settings.webhook.url) {
        results.push({ channel: "webhook", ok: false, detail: "no webhook URL configured" });
      } else {
        results.push(await this.postWebhook(alert));
      }
    }

    if (this.settings.email.enabled || isTest) {
      if (!this.settings.email.to) {
        results.push({ channel: "email", ok: false, detail: "no recipient configured" });
      } else if (!this.emailConfigured()) {
        results.push({ channel: "email", ok: false, detail: "Gmail credentials not configured" });
      } else {
        results.push(await this.sendEmail(alert));
      }
    }

    alert.channels = results;
    return results;
  }

  private async postWebhook(alert: Alert): Promise<ChannelResult> {
    try {
      const res = await fetch(this.settings.webhook.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "agentguard-x",
          id: alert.id,
          severity: alert.severity,
          kind: alert.kind,
          title: alert.title,
          missionId: alert.missionId,
          createdAt: alert.createdAt,
        }),
        signal: AbortSignal.timeout(8000),
      });
      return { channel: "webhook", ok: res.ok, detail: `HTTP ${res.status}` };
    } catch (err) {
      return { channel: "webhook", ok: false, detail: (err as Error).message };
    }
  }

  private async sendEmail(alert: Alert): Promise<ChannelResult> {
    try {
      // Imported lazily so the app runs without the mail dependency configured.
      const nodemailer = (await import("nodemailer")).default;
      const transport = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      });
      const info = await transport.sendMail({
        from: process.env.GMAIL_USER,
        to: this.settings.email.to,
        subject: `[AgentGuard X] ${alert.severity.toUpperCase()} — ${alert.title.slice(0, 90)}`,
        text: [
          alert.title,
          "",
          alert.detail,
          `severity : ${alert.severity}`,
          `kind     : ${alert.kind}`,
          `mission  : ${alert.missionId}`,
          `time     : ${alert.createdAt}`,
          "",
          "DEMO / SANDBOX / NO REAL DATA — sent by AgentGuard X",
        ].join("\n"),
      });
      return { channel: "email", ok: true, detail: `sent (${info.messageId})` };
    } catch (err) {
      return { channel: "email", ok: false, detail: (err as Error).message };
    }
  }
}
