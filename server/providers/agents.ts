import type { Application } from '@nocobase/app-server/application';
import { loggingToken } from '@nocobase/app-server/logging';
import {
  agentsAccessToken,
  agentsToken,
} from '@nocobase/app-plugin-agents/server/tokens';
import { databaseManagerToken } from '@nocobase/db';
import {
  createServiceToken,
  ServiceProvider,
  type ServiceToken,
} from '@nocobase/service-provider';

import { INCIDENT_ACTIONS, IncidentAgents } from '../agents/incident-agent.js';
import { SETUP_ACTIONS, SetupAgents } from '../agents/setup-agent.js';
import {
  diagnosisLanguage,
  monitoringServiceToken,
  remediationServiceToken,
} from './monitoring.js';

export const incidentAgentsToken: ServiceToken<IncidentAgents> =
  createServiceToken<IncidentAgents>('nocomonitor/incident-agents');

export const setupAgentsToken: ServiceToken<SetupAgents> =
  createServiceToken<SetupAgents>('nocomonitor/setup-agents');

/**
 * Connects NocoMonitor to the Agents plugin: the incident subject and automatic diagnosis of every incident a probe
 * opens on a monitor with AI diagnosis on, the setup subject people set up monitoring through, and the one gate both
 * subjects' commands go through.
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
          (conn) => diagnosisLanguage(this.app.container, conn),
        ),
    );
    this.app.container.singleton(
      setupAgentsToken,
      () =>
        new SetupAgents(
          this.app.container.resolve(agentsToken),
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(monitoringServiceToken),
          this.app.container.resolve(remediationServiceToken),
          this.app.container.resolve(loggingToken).getLogger('setup-agents'),
        ),
    );
  }

  public override boot(): Promise<void> {
    if (!this.app.container.has(agentsToken)) return Promise.resolve();
    const agents = this.app.container.resolve(agentsToken);
    const incidents = this.app.container.resolve(incidentAgentsToken);
    const setups = this.app.container.resolve(setupAgentsToken);
    this.cleanups.push(incidents.register(), setups.register());
    this.cleanups.push(
      // `defaultOn` only marks the catalog; the defaults are what every agent discovered from a runner is given, so any
      // of them can diagnose an incident and help set up monitoring. The gate still limits each action to its own run.
      agents.agents.setDefaults(() => ({
        instructions: null,
        actions: [...INCIDENT_ACTIONS, ...SETUP_ACTIONS],
      })),
      // Each subject's commands belong to a run on that subject. People reach both through the pages and their API.
      agents.gate.set({
        allowed: async (identity) =>
          new Set([
            ...(await incidents.allowedActions(identity)),
            ...(await setups.allowedActions(identity)),
          ]),
      }),
    );
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
        .info({ changed }, 'Gave agents the incident and setup actions');
  }

  public override shutdown(): Promise<void> {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    return Promise.resolve();
  }
}
