import type { PagePermissionTitles } from './page-permissions.js';

/** Permission labels for application pages without navigation/breadcrumb titles (including overlays).
 * Keys are existing route names; values are application translation keys.
 * Do not add navigation/breadcrumbs or change authorization ids just to name a permission.
 */
export const pagePermissionTitles: PagePermissionTitles = {
  'runtimes-connect': 'monitoring.navigation.connectRuntime',
  'skills-new': 'monitoring.navigation.newSkill',
  'skills-detail': 'monitoring.navigation.skill',
};
