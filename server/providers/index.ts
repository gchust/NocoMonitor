import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import MonitoringProvider from './monitoring.js';

export { monitoringServiceToken } from './monitoring.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  MonitoringProvider,
];

export default serviceProviders;
