import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import AgentsIntegrationProvider from './agents.js';
import MonitoringProvider from './monitoring.js';

export {
  monitoringServiceToken,
  remediationServiceToken,
} from './monitoring.js';
export { incidentAgentsToken } from './agents.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  MonitoringProvider,
  AgentsIntegrationProvider,
];

export default serviceProviders;
