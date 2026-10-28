import type { Application } from '@nocobase/app-server/application';
import { loggingToken } from '@nocobase/app-server/logging';
import {
  agentsAccessToken,
  agentsToken,
} from '@nocobase/app-plugin-agents/server/tokens';
import {
  createServiceToken,
  ServiceProvider,
  type ServiceToken,
} from '@nocobase/service-provider';

import { IncidentAgents } from '../agents/incident-agent.js';
import {
  monitoringServiceToken,
  remediationServiceToken,
} from './monitoring.js';

export const incidentAgentsToken: ServiceToken<IncidentAgents> =
  createServiceToken<IncidentAgents>('nocomonitor/incident-agents');

/**
 * Connects incidents to the Agents plugin: the incident subject and its commands' gate, and automatic diagnosis of
 * every incident a probe opens on a monitor with AI diagnosis on.
 */
export default class AgentsIntegrationProvider extends ServiceProvider<Application> {
  public readonly name: string = 'nocomonitor/agents';

  private cleanups: (() => void)[] = [];

  public override register(): void {
    // NocoMonitor gives no business-action reach over agents and skills beyond the `agents.agents` settings grant.
    this.app.container.singleton(agentsAccessToken, () => ({
      scopeOf: () => Promise.resolve('none' as const),
    }));
    this.app.container.singleton(
      incidentAgentsToken,
      () =>
        new IncidentAgents(
          this.app.container.resolve(agentsToken),
          this.app.container.resolve(monitoringServiceToken),
          this.app.container.resolve(remediationServiceToken),
          this.app.container.resolve(loggingToken).getLogger('incident-agents'),
        ),
    );
  }

  public override boot(): Promise<void> {
    if (!this.app.container.has(agentsToken)) return Promise.resolve();
    const incidents = this.app.container.resolve(incidentAgentsToken);
    this.cleanups.push(incidents.register());
    this.cleanups.push(
      this.app.container.resolve(monitoringServiceToken).on(async (event) => {
        if (event.type === 'incident.opened')
          await incidents.onIncidentOpened(event.incident, event.monitor);
      }),
    );
    return Promise.resolve();
  }

  public override async start(): Promise<void> {
    if (!this.app.container.has(agentsToken)) return;
    // Agents added before these defaults existed, or before an action was added to them, get them now.
    const changed = await this.app.container
      .resolve(agentsToken)
      .agents.applyDefaults({ preserveInstructions: true });
    if (changed)
      this.app.container
        .resolve(loggingToken)
        .getLogger('agents')
        .info({ changed }, 'Gave agents the incident actions');
  }

  public override shutdown(): Promise<void> {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    return Promise.resolve();
  }
}
