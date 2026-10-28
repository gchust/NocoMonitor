import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import { agentIncidentRoutes } from './agent-incident.js';
import { aiRoutes } from './ai.js';
import { alertRoutes } from './alerts.js';
import { drillRoutes } from './drill.js';
import { monitoringRoutes } from './monitoring.js';
import { publicStatusRoutes } from './public-status.js';
import { setupRoutes } from './setups.js';

const routes: readonly AppRouteContribution<Application>[] = [
  publicStatusRoutes,
  monitoringRoutes,
  aiRoutes,
  agentIncidentRoutes,
  drillRoutes,
  alertRoutes,
  setupRoutes,
];

export default routes;
