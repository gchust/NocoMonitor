import appPackage from '../../package.json' with { type: 'json' };
import type { Application } from '@nocobase/app-server/application';
import { idGeneratorToken } from '@nocobase/app-server/id-generator';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { loggingToken } from '@nocobase/app-server/logging';
import {
  AUTHORIZATION_NAMESPACE,
  authorizationToken,
} from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import type { ScheduleExecutor } from '@nocobase/jobs';
import {
  createServiceToken,
  ServiceProvider,
  type ServiceToken,
} from '@nocobase/service-provider';

import { MonitoringService } from '../monitoring/service.js';

export const monitoringServiceToken: ServiceToken<MonitoringService> =
  createServiceToken<MonitoringService>('nocomonitor/monitoring-service');

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

export default class MonitoringProvider extends ServiceProvider<Application> {
  public readonly name: string = 'nocomonitor/monitoring';

  private executor: ScheduleExecutor | undefined;

  public override register(): void {
    this.app.container.singleton(monitoringServiceToken, () => {
      const logging = this.app.container.resolve(loggingToken);
      return new MonitoringService(
        this.app.container.resolve(databaseManagerToken),
        this.app.container.resolve(idGeneratorToken),
        logging.getLogger('monitoring'),
      );
    });
  }

  public override async boot(): Promise<void> {
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
    await this.executor?.shutdown();
  }
}
