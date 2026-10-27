import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import { monitoringRoutes } from './monitoring.js';
import { publicStatusRoutes } from './public-status.js';

const routes: readonly AppRouteContribution<Application>[] = [publicStatusRoutes, monitoringRoutes];

export default routes;
