import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import { agentIncidentRoutes } from './agent-incident.js';
import { aiRoutes } from './ai.js';
import { monitoringRoutes } from './monitoring.js';
import { publicStatusRoutes } from './public-status.js';

const routes: readonly AppRouteContribution<Application>[] = [
  publicStatusRoutes,
  monitoringRoutes,
  aiRoutes,
  agentIncidentRoutes,
];

export default routes;
