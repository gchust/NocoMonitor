import appPackage from '../../package.json' with { type: 'json' };
import type { Application } from '@nocobase/app-server/application';
import { i18nToken } from '@nocobase/app-server/i18n';
import { idGeneratorToken } from '@nocobase/app-server/id-generator';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { loggingToken } from '@nocobase/app-server/logging';
import {
  AUTHORIZATION_NAMESPACE,
  authorizationToken,
} from '@nocobase/app-plugin-authorization/server';
import { notificationServiceToken } from '@nocobase/app-plugin-notification/server';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import type { ScheduleExecutor } from '@nocobase/jobs';
import {
  createServiceToken,
  ServiceProvider,
  type ServiceContainer,
  type ServiceToken,
} from '@nocobase/service-provider';

import {
  AlertService,
  channelKind,
  type AlertPorts,
  type AlertRecipient,
} from '../monitoring/alerts.js';
import { DrillService, type DrillWording } from '../monitoring/drill.js';
import {
  resolveLanguage,
  type DiagnosisLanguage,
  type IncidentWording,
} from '../monitoring/language.js';
import { RemediationService } from '../monitoring/remediation.js';
import { MonitoringService } from '../monitoring/service.js';

export const monitoringServiceToken: ServiceToken<MonitoringService> =
  createServiceToken<MonitoringService>('nocomonitor/monitoring-service');

/** Fixes for incidents and the AI settings: see `RemediationService`. */
export const remediationServiceToken: ServiceToken<RemediationService> =
  createServiceToken<RemediationService>('nocomonitor/remediation-service');

/** The drill: see `DrillService`. */
export const drillServiceToken: ServiceToken<DrillService> =
  createServiceToken<DrillService>('nocomonitor/drill-service');

/** Alert notifications: see `AlertService`. */
export const alertServiceToken: ServiceToken<AlertService> =
  createServiceToken<AlertService>('nocomonitor/alert-service');

/** The settings item every monitoring page and endpoint is checked against. */
export const MONITORING_RESOURCE = {
  type: 'settings',
  id: 'monitoring',
} as const;
export type MonitoringAction = 'read' | 'manage';

/** How often the probe loop looks for due monitors; each monitor keeps its own interval. */
const TICK_MS = 10_000;
/** Raw checks are kept this long; the daily rollup keeps the totals for the uptime bars. */
const CHECK_RETENTION_DAYS = 14;

/** The language AI settings choose for diagnoses and opened incidents, or the application's default locale. */
export async function diagnosisLanguage(
  container: ServiceContainer,
  conn?: DatabaseConnection,
): Promise<DiagnosisLanguage> {
  const settings = await container
    .resolve(remediationServiceToken)
    .aiSettings(conn);
  return resolveLanguage(
    settings.language,
    container.resolve(i18nToken).getDefaultLocale(),
  );
}

export default class MonitoringProvider extends ServiceProvider<Application> {
  public readonly name: string = 'nocomonitor/monitoring';

  private executor: ScheduleExecutor | undefined;
  private stopListening: (() => void) | undefined;
  private stopAlerts: (() => void) | undefined;

  public override register(): void {
    this.app.container.singleton(monitoringServiceToken, () => {
      const logging = this.app.container.resolve(loggingToken);
      return new MonitoringService(
        this.app.container.resolve(databaseManagerToken),
        this.app.container.resolve(idGeneratorToken),
        logging.getLogger('monitoring'),
        fetch,
        () => this.incidentWording(),
      );
    });
    this.app.container.singleton(
      remediationServiceToken,
      () =>
        new RemediationService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(monitoringServiceToken),
          this.app.container.resolve(loggingToken).getLogger('remediation'),
        ),
    );
    this.app.container.singleton(
      drillServiceToken,
      () =>
        new DrillService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(monitoringServiceToken),
          () => this.drillWording(),
        ),
    );
    this.app.container.singleton(
      alertServiceToken,
      () =>
        new AlertService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(loggingToken).getLogger('alerts'),
          this.alertPorts(),
        ),
    );
  }

  /** A translator for the application's server texts in the diagnosis language: plain text, nothing escaped. */
  private async translator(): Promise<
    (key: string, values?: Record<string, unknown>) => string
  > {
    const i18n = this.app.container.resolve(i18nToken);
    const locale = await diagnosisLanguage(this.app.container);
    await i18n.ensureLocaleLoaded(locale);
    const t = i18n.getFixedT(appPackage.name, locale);
    return (key, values) =>
      t(key, { ...values, interpolation: { escapeValue: false } });
  }

  /** The drill's records, named in the operators' language. */
  private async drillWording(): Promise<DrillWording> {
    const t = await this.translator();
    return {
      serviceName: t('monitoring.drill.serviceName'),
      serviceDescription: t('monitoring.drill.serviceDescription'),
      monitorName: t('monitoring.drill.monitorName'),
      actionTitle: t('monitoring.drill.actionTitle'),
      actionDescription: t('monitoring.drill.actionDescription'),
      // For the agent: in English whatever the language, like its instructions.
      runbook: [
        'This service is a NocoMonitor drill, a rehearsal of the automatic response.',
        'Its health check is served by NocoMonitor itself and was made to fail on purpose: it answers HTTP 503 until the',
        'fix `recover` runs. Nothing else is wrong and nothing outside NocoMonitor is involved.',
        'Diagnose it as you would a real outage: probe the endpoint, state the cause, then request the fix `recover`.',
      ].join('\n'),
    };
  }

  private alertPorts(): AlertPorts {
    const container = this.app.container;
    const read = <T>(path: string): T | undefined =>
      (this.app.config as unknown as { get(path: string): unknown }).get(
        path,
      ) as T | undefined;
    const toRecipient = (user: {
      id: string;
      name: string;
      email: string;
    }): AlertRecipient => ({
      id: user.id,
      name: user.name,
      email: user.email || null,
    });
    return {
      channels: () =>
        Object.entries(
          read<
            Record<
              string,
              { type?: string; provider?: string; enabled?: boolean }
            >
          >('notification.channels') ?? {},
        )
          .filter(([, channel]) => channel.enabled !== false)
          .map(([name, channel]) => {
            const type = channel.type ?? channel.provider ?? '';
            return { name, type, kind: channelKind(type) };
          }),
      send: async (input) =>
        container.has(notificationServiceToken)
          ? container.resolve(notificationServiceToken).send(input as never)
          : null,
      status: async (key) =>
        container.has(notificationServiceToken)
          ? ((await container
              .resolve(notificationServiceToken)
              .getByIdempotencyKey(key)) ?? null)
          : null,
      users: async (ids) => {
        if (!container.has(userManagementServiceToken)) return [];
        const users = container.resolve(userManagementServiceToken);
        const found = await Promise.all(
          ids.map((id) => users.get(id).catch(() => null)),
        );
        // A deleted or disabled account is no longer told anything.
        return found
          .filter((user) => user !== null && user.disabledAt === null)
          .map((user) => toRecipient(user!));
      },
      searchUsers: async (query) => {
        if (!container.has(userManagementServiceToken)) return [];
        const page = await container.resolve(userManagementServiceToken).list({
          search: query || undefined,
          status: 'enabled',
          pageSize: 20,
        });
        return page.items
          .filter((user) => user.kind !== 'service')
          .map(toRecipient);
      },
      translator: () => this.translator(),
      incidentUrl: (incidentId) => {
        const origin = read<string>('app.publicOrigin');
        if (!origin) return null;
        const base = (read<string>('app.publicBasePath') ?? '').replace(
          /\/+$/u,
          '',
        );
        return `${origin.replace(/\/+$/u, '')}${base}/incidents/${incidentId}`;
      },
      serviceName: async (serviceId) =>
        (await container.resolve(monitoringServiceToken).getService(serviceId))
          ?.name ?? null,
    };
  }

  private async incidentWording(): Promise<IncidentWording> {
    const i18n = this.app.container.resolve(i18nToken);
    const locale = await diagnosisLanguage(this.app.container);
    await i18n.ensureLocaleLoaded(locale);
    const t = i18n.getFixedT(appPackage.name, locale);
    // Plain text for the database, not HTML: interpolated values are not escaped.
    const raw = { interpolation: { escapeValue: false } };
    return {
      downTitle: (monitor) =>
        t('monitoring.incident.downTitle', { monitor, ...raw }),
      detected: (error, count) =>
        t('monitoring.incident.detected', {
          error: error ?? t('monitoring.incident.checkFailed'),
          count,
          ...raw,
        }),
    };
  }

  public override async boot(): Promise<void> {
    const monitoring = this.app.container.resolve(monitoringServiceToken);
    const alerts = this.app.container.resolve(alertServiceToken);
    const drill = this.app.container.resolve(drillServiceToken);
    this.stopAlerts = monitoring.on(async (event) => {
      await drill.handle(event);
      await alerts.handle(event);
    });
    if (!this.app.container.has(authorizationToken)) return;
    const authz = this.app.container.resolve(authorizationToken);
    authz.ui.sections.add({
      name: 'monitoring',
      title: { key: 'monitoring.authorization.section', ns: appPackage.name },
      parent: 'business',
    });
    authz.settings.add({
      id: MONITORING_RESOURCE.id,
      title: { key: 'monitoring.authorization.title', ns: appPackage.name },
      actions: (['read', 'manage'] as const).map((name) => ({
        name,
        title:
          name === 'read'
            ? { key: `options.actions.${name}`, ns: AUTHORIZATION_NAMESPACE }
            : { key: 'monitoring.authorization.manage', ns: appPackage.name },
      })),
    });
    authz.ui.place(MONITORING_RESOURCE, { section: 'monitoring' });
  }

  public override async start(): Promise<void> {
    // Commands such as `db apply` boot the application without serving it; they must not start probing.
    if (this.app.nodeEnv === 'test') return;
    const service = this.app.container.resolve(monitoringServiceToken);
    const remediation = this.app.container.resolve(remediationServiceToken);
    // A resolved incident settles the fixes still being verified for it: the service recovered.
    this.stopListening = service.on(async (event) => {
      if (event.type === 'incident.resolved')
        await remediation.settleResolved(event.incident.id);
    });
    const logger = this.app.container
      .resolve(loggingToken)
      .getLogger('monitoring');
    this.executor = this.app.container
      .resolve(jobExecutorServiceToken)
      .getScheduleExecutor(appPackage.name);
    let busy = false;
    await this.executor.addJob({
      name: 'probe-tick',
      options: { every: TICK_MS },
      payload: {},
      execute: async () => {
        // A tick that is still probing slow monitors lets the next one pass rather than piling up.
        if (busy) return;
        busy = true;
        try {
          await service.runDueChecks();
          await remediation.verifyDue();
        } finally {
          busy = false;
        }
      },
    });
    await this.executor.addJob({
      name: 'prune-checks',
      options: { cron: '17 3 * * *' },
      payload: {},
      execute: async () => {
        const deleted = await service.pruneChecks(CHECK_RETENTION_DAYS);
        logger.info({ deleted }, 'Pruned old checks');
      },
    });
    await this.executor.setup();
  }

  public override async shutdown(): Promise<void> {
    this.stopListening?.();
    this.stopAlerts?.();
    await this.executor?.shutdown();
  }
}
