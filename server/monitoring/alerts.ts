import type { DatabaseManager } from '@nocobase/db';

import type { MonitoringEvent, MonitoringLogger } from './service.js';
import {
  ALERT_EVENTS,
  type AlertEvent,
  type AlertSettings,
  type IncidentRecord,
} from './types.js';

/** Recent sends kept for the settings page; the notification plugin keeps the full history. */
const LOG_LIMIT = 20;

export const DEFAULT_ALERT_EVENTS: Record<AlertEvent, boolean> = {
  incidentOpened: true,
  fixAwaitingApproval: true,
  diagnosisFailed: true,
  fixNotRecovered: true,
  // Off by default: alerts are for what needs people.
  incidentResolved: false,
};

/** How NocoMonitor addresses a configured channel: by the people chosen, or the channel's own group. */
export type AlertChannelKind = 'inApp' | 'email' | 'webhook' | 'unsupported';

export interface AlertChannel {
  name: string;
  type: string;
  kind: AlertChannelKind;
}

export interface AlertRecipient {
  id: string;
  name: string;
  email: string | null;
}

export type AlertDeliveryStatus =
  'pending' | 'delivered' | 'partial' | 'failed' | 'unknown';

export interface AlertDelivery {
  key: string;
  event: AlertEvent | 'test';
  incidentId: string | null;
  title: string;
  at: Date;
  status: AlertDeliveryStatus;
  channels: { name: string; status: AlertDeliveryStatus }[];
}

interface LogItem {
  key: string;
  event: AlertEvent | 'test';
  incidentId: string | null;
  title: string;
  at: string;
  /** Set when the send was refused before reaching the notification service. */
  refused?: boolean;
}

/** A notification as NocoMonitor writes it, before it is shaped for each channel. */
interface Alert {
  event: AlertEvent | 'test';
  key: string;
  incidentId: string | null;
  title: string;
  body: string;
}

/** What the alerts need from the rest of the application, so tests can stand in for it. */
export interface AlertPorts {
  /** The channels configured in `notification.channels`. */
  channels(): AlertChannel[];
  /** Sends through the notification service; null when no notification service is installed. */
  send(input: {
    idempotencyKey: string;
    source: { type: string; referenceId?: string };
    messages: Record<string, unknown>;
  }): Promise<{ status: string } | null>;
  /** The status the notification service records for a send. */
  status(key: string): Promise<{
    status: string;
    deliveries: readonly { channelName: string; status: string }[];
  } | null>;
  users(ids: readonly string[]): Promise<AlertRecipient[]>;
  searchUsers(query: string): Promise<AlertRecipient[]>;
  /** A translator for alert texts in the operators' language. */
  translator(): Promise<
    (key: string, values?: Record<string, unknown>) => string
  >;
  /** The incident page's full URL, for email and IM; null when the public origin is unknown. */
  incidentUrl(incidentId: string): string | null;
  /** The service's name, for alert texts. */
  serviceName(serviceId: string): Promise<string | null>;
}

export class AlertError extends Error {
  constructor(
    readonly reason: 'UNKNOWN_CHANNEL' | 'NO_DESTINATION' | 'NOT_INSTALLED',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Alert notifications: who is told about what, through which of the configured notification channels. Only people
 * chosen one by one receive anything. In-app and email channels reach those people; a webhook channel (Feishu,
 * DingTalk) posts to its own group. Each incident event is sent once, whatever retries happen.
 */
/** How long an incident lasted, in whole minutes (at least one), for a notification. */
function lasted(
  incident: IncidentRecord,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  // Records read back from storage can carry their timestamps as strings.
  const end = new Date(incident.resolvedAt ?? Date.now()).getTime();
  const start = new Date(incident.startedAt).getTime();
  const total = Math.max(1, Math.round((end - start) / 60_000));
  return total < 60
    ? t('monitoring.notify.minutes', { minutes: total })
    : t('monitoring.notify.hours', {
        hours: Math.floor(total / 60),
        minutes: total % 60,
      });
}

export class AlertService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly logger: MonitoringLogger,
    private readonly ports: AlertPorts,
  ) {}

  channels(): AlertChannel[] {
    return this.ports.channels();
  }

  async settings(): Promise<AlertSettings> {
    const row = await this.db
      .repository<{ key: string; value: Partial<AlertSettings> }>('mnSettings')
      .findOne({ filter: { key: 'alerts' } });
    const value = row?.value ?? {};
    const configured = new Set(this.channels().map((channel) => channel.name));
    return {
      recipients: value.recipients ?? [],
      // Until saved, every in-app channel: the inbox is where people look first.
      channels: (
        value.channels ??
        this.channels()
          .filter((channel) => channel.kind === 'inApp')
          .map((channel) => channel.name)
      ).filter((name) => configured.has(name)),
      events: { ...DEFAULT_ALERT_EVENTS, ...(value.events ?? {}) },
    };
  }

  async saveSettings(
    value: AlertSettings,
    userId: string | null,
  ): Promise<AlertSettings> {
    const known = new Map(this.channels().map((c) => [c.name, c]));
    for (const name of value.channels) {
      const channel = known.get(name);
      if (!channel || channel.kind === 'unsupported')
        throw new AlertError(
          'UNKNOWN_CHANNEL',
          `Channel ${name} is not configured, or NocoMonitor cannot address it.`,
        );
    }
    const stored: AlertSettings = {
      recipients: [...new Set(value.recipients)],
      channels: [...new Set(value.channels)],
      events: Object.fromEntries(
        ALERT_EVENTS.map((event) => [event, value.events[event] === true]),
      ) as Record<AlertEvent, boolean>,
    };
    await this.db.repository('mnSettings').upsertOne({
      filter: { key: 'alerts' },
      create: {
        key: 'alerts',
        value: stored,
        updatedById: userId,
        updatedAt: new Date(),
      },
      update: { value: stored, updatedById: userId, updatedAt: new Date() },
    });
    return stored;
  }

  /** The chosen recipients with their names, for the settings page. */
  async recipients(ids: readonly string[]): Promise<AlertRecipient[]> {
    return ids.length ? this.ports.users(ids) : [];
  }

  searchRecipients(query: string): Promise<AlertRecipient[]> {
    return this.ports.searchUsers(query);
  }

  /** Sends the alert a monitoring event calls for, if its event is switched on. */
  async handle(event: MonitoringEvent): Promise<void> {
    const alert = await this.alertFor(event);
    if (!alert) return;
    const settings = await this.settings();
    if (!settings.events[alert.event as AlertEvent]) return;
    try {
      await this.deliver(alert, settings);
    } catch (error) {
      if (error instanceof AlertError) return;
      throw error;
    }
  }

  /** One test message through every chosen channel, with the saved settings. */
  async test(): Promise<AlertDelivery> {
    const t = await this.ports.translator();
    const settings = await this.settings();
    const alert: Alert = {
      event: 'test',
      key: `nocomonitor:test:${Date.now()}`,
      incidentId: null,
      title: t('monitoring.notify.test.title'),
      body: t('monitoring.notify.test.body'),
    };
    await this.deliver(alert, settings);
    const [delivery] = await this.deliveries(1);
    return delivery;
  }

  /** The latest sends with what the notification service reports for each channel. */
  async deliveries(limit = LOG_LIMIT): Promise<AlertDelivery[]> {
    const items = (await this.log()).slice(0, limit);
    // An alert outlives its incident (an ended drill deletes its own): it then keeps its title but links nowhere.
    const ids = [...new Set(items.flatMap((item) => item.incidentId ?? []))];
    const existing = new Set(
      ids.length
        ? (
            await this.db
              .query()
              .selectFrom('mnIncidents')
              .select('id')
              .where('id', 'in', ids)
              .execute()
          ).map((row) => String(row.id))
        : [],
    );
    return Promise.all(
      items.map(async (item) => {
        const snapshot = item.refused
          ? null
          : await this.ports.status(item.key).catch(() => null);
        return {
          key: item.key,
          event: item.event,
          incidentId:
            item.incidentId && existing.has(item.incidentId)
              ? item.incidentId
              : null,
          title: item.title,
          at: new Date(item.at),
          status: item.refused ? 'failed' : statusOf(snapshot?.status),
          channels: (snapshot?.deliveries ?? []).map((delivery) => ({
            name: delivery.channelName,
            status: statusOf(delivery.status),
          })),
        };
      }),
    );
  }

  private async alertFor(event: MonitoringEvent): Promise<Alert | null> {
    const kind = EVENT_OF[event.type];
    if (!kind || !('incident' in event)) return null;
    const incident: IncidentRecord = event.incident;
    // An incident that joined a group is told by the alerts of the incident that leads it: one event, one alert.
    if (
      incident.groupId &&
      (event.type === 'incident.opened' || event.type === 'incident.resolved')
    )
      return null;
    const t = await this.ports.translator();
    const service = (await this.ports.serviceName(incident.serviceId)) ?? '';
    const values = { incident: incident.title, service };
    switch (event.type) {
      case 'incident.opened':
        return {
          event: kind,
          key: `nocomonitor:${kind}:${incident.id}`,
          incidentId: incident.id,
          title: t('monitoring.notify.incidentOpened.title', values),
          body: t('monitoring.notify.incidentOpened.body', values),
        };
      case 'incident.resolved':
        return {
          event: kind,
          key: `nocomonitor:${kind}:${incident.id}`,
          incidentId: incident.id,
          title: t('monitoring.notify.incidentResolved.title', values),
          body: t('monitoring.notify.incidentResolved.body', {
            ...values,
            duration: lasted(incident, t),
          }),
        };
      case 'diagnosis.failed':
        return {
          event: kind,
          // One per run: a retried diagnosis that fails again is news.
          key: `nocomonitor:${kind}:${incident.id}:${incident.aiRunId ?? 'none'}`,
          incidentId: incident.id,
          title: t('monitoring.notify.diagnosisFailed.title', values),
          body: t('monitoring.notify.diagnosisFailed.body', values),
        };
      case 'remediation.awaitingApproval':
      case 'remediation.notRecovered': {
        const action = event.remediation.actionTitle;
        const prefix =
          event.type === 'remediation.awaitingApproval'
            ? 'fixAwaitingApproval'
            : 'fixNotRecovered';
        return {
          event: kind,
          key: `nocomonitor:${kind}:${incident.id}:${event.remediation.id}`,
          incidentId: incident.id,
          title: t(`monitoring.notify.${prefix}.title`, { ...values, action }),
          body: t(`monitoring.notify.${prefix}.body`, {
            ...values,
            action,
            reason: event.remediation.reason,
          }),
        };
      }
      default:
        return null;
    }
  }

  private async deliver(alert: Alert, settings: AlertSettings): Promise<void> {
    const channels = new Map(this.channels().map((c) => [c.name, c]));
    const people = await this.recipients(settings.recipients);
    const t = await this.ports.translator();
    const url = alert.incidentId
      ? this.ports.incidentUrl(alert.incidentId)
      : null;
    const messages: Record<string, unknown> = {};
    for (const name of settings.channels) {
      const channel = channels.get(name);
      if (!channel) continue;
      if (channel.kind === 'inApp' && people.length)
        messages[name] = {
          to: people.map((person) => person.id),
          title: alert.title,
          body: alert.body,
          ...(alert.incidentId
            ? {
                target: {
                  type: 'route',
                  path: `/incidents/${alert.incidentId}`,
                },
              }
            : {}),
        };
      if (channel.kind === 'email') {
        const addresses = people
          .map((person) => person.email)
          .filter((email): email is string => Boolean(email));
        if (addresses.length) {
          const text = url
            ? `${alert.body}\n\n${t('monitoring.notify.open', { url })}`
            : alert.body;
          messages[name] = {
            to: addresses,
            subject: alert.title,
            text,
          };
        }
      }
      if (channel.kind === 'webhook')
        messages[name] = {
          title: alert.title,
          text: alert.body,
          ...(url ? { target: { type: 'url', url } } : {}),
        };
    }
    if (!Object.keys(messages).length)
      throw new AlertError(
        'NO_DESTINATION',
        'No chosen channel can reach anyone: choose recipients, or a webhook channel.',
      );
    let refused = false;
    try {
      const sent = await this.ports.send({
        idempotencyKey: alert.key,
        source: {
          type: 'nocomonitor',
          ...(alert.incidentId ? { referenceId: alert.incidentId } : {}),
        },
        messages,
      });
      if (!sent)
        throw new AlertError(
          'NOT_INSTALLED',
          'The notification service is not installed.',
        );
    } catch (error) {
      if (error instanceof AlertError) throw error;
      refused = true;
      this.logger.warn(
        {
          key: alert.key,
          error: error instanceof Error ? error.message : String(error),
        },
        'An alert notification was refused',
      );
    }
    await this.remember({
      key: alert.key,
      event: alert.event,
      incidentId: alert.incidentId,
      title: alert.title,
      at: new Date().toISOString(),
      ...(refused ? { refused } : {}),
    });
  }

  private async log(): Promise<LogItem[]> {
    const row = await this.db
      .repository<{ key: string; value: { items?: LogItem[] } }>('mnSettings')
      .findOne({ filter: { key: 'alertLog' } });
    return row?.value.items ?? [];
  }

  private async remember(item: LogItem): Promise<void> {
    const items = [
      item,
      ...(await this.log()).filter((entry) => entry.key !== item.key),
    ].slice(0, LOG_LIMIT);
    await this.db.repository('mnSettings').upsertOne({
      filter: { key: 'alertLog' },
      create: { key: 'alertLog', value: { items }, updatedAt: new Date() },
      update: { value: { items }, updatedAt: new Date() },
    });
  }
}

const EVENT_OF: Partial<Record<MonitoringEvent['type'], AlertEvent>> = {
  'incident.opened': 'incidentOpened',
  'incident.resolved': 'incidentResolved',
  'diagnosis.failed': 'diagnosisFailed',
  'remediation.awaitingApproval': 'fixAwaitingApproval',
  'remediation.notRecovered': 'fixNotRecovered',
};

/** The notification service's many states, as the settings page tells them. */
function statusOf(status: string | undefined): AlertDeliveryStatus {
  switch (status) {
    case 'completed':
    case 'accepted':
      return 'delivered';
    case 'partial':
      return 'partial';
    case 'failed':
      return 'failed';
    case 'unknown':
    case undefined:
      return 'unknown';
    default:
      return 'pending';
  }
}

/** How NocoMonitor can address a channel of this type. */
export function channelKind(type: string): AlertChannelKind {
  if (type === 'in-app') return 'inApp';
  if (type === 'smtp' || type === 'resend') return 'email';
  if (type.endsWith('-webhook')) return 'webhook';
  return 'unsupported';
}
