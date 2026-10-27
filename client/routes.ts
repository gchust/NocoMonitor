import { Activity, Boxes, Globe, LayoutDashboard, Siren } from 'lucide-react';
import {
  defineAppRoutes,
  type AppClientRouteContribution,
} from '@nocobase/app-client/plugins';

import systemSettingsRoutes from './pages/settings/routes.js';

/** Every monitoring page is granted as one settings item, `monitoring`; `manage` gates changes inside the pages. */
const monitoringRead = {
  resource: { type: 'settings', id: 'monitoring' },
  action: 'read',
} as const;

const appRoutes: AppClientRouteContribution = defineAppRoutes([
  {
    // Every signed-in user reaches the landing page. `authz: 'skip'` takes it out of page authorization entirely, so
    // no permission change can leave a user signed in with nowhere to land; the overview's API still requires
    // `monitoring` read, and the page says so to a user without it.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/overview/index.js'),
    name: 'home',
    navigation: {
      title: 'monitoring.navigation.overview',
      icon: LayoutDashboard,
      order: 1,
    },
    path: '/',
  },
  {
    auth: 'required',
    authz: monitoringRead,
    componentLoader: () => import('./pages/monitors/index.js'),
    name: 'monitors',
    navigation: {
      title: 'monitoring.navigation.monitors',
      icon: Activity,
      order: 2,
    },
    path: '/monitors',
    children: [
      {
        componentLoader: () => import('./pages/monitors/detail.js'),
        name: 'monitor',
        path: ':monitorId',
      },
    ],
  },
  {
    auth: 'required',
    authz: monitoringRead,
    componentLoader: () => import('./pages/incidents/index.js'),
    name: 'incidents',
    navigation: {
      title: 'monitoring.navigation.incidents',
      icon: Siren,
      order: 3,
    },
    path: '/incidents',
    children: [
      {
        componentLoader: () => import('./pages/incidents/detail.js'),
        name: 'incident',
        path: ':incidentId',
      },
    ],
  },
  {
    auth: 'required',
    authz: monitoringRead,
    componentLoader: () => import('./pages/services/index.js'),
    name: 'services',
    navigation: {
      title: 'monitoring.navigation.services',
      icon: Boxes,
      order: 4,
    },
    path: '/services',
  },
  {
    auth: 'required',
    authz: monitoringRead,
    componentLoader: () => import('./pages/status-pages/index.js'),
    name: 'statusPages',
    navigation: {
      title: 'monitoring.navigation.statusPages',
      icon: Globe,
      order: 5,
    },
    path: '/status-pages',
  },
  {
    // The public status page: anyone may read it, signed in or not, and it renders outside the shell.
    auth: 'optional',
    authz: 'skip',
    componentLoader: () => import('./pages/status/public.js'),
    name: 'publicStatus',
    path: '/status/:slug',
  },
  {
    // Declares no navigation, so the application decides where its entry goes (for example a sidebar item with an
    // unread badge). The plugin's API answers each person's own messages only, so the page needs no authorization of
    // its own.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/inbox.js'),
    name: 'inbox',
    path: '/inbox',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/login.js'),
    name: 'login',
    path: '/login',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/register.js'),
    name: 'register',
    path: '/register',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/forgot-password.js'),
    name: 'forgot-password',
    path: '/forgot-password',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/reset-password.js'),
    name: 'reset-password',
    path: '/reset-password',
  },
  {
    // Where a command line's sign-in sends the person to approve it (`pages/auth/device.tsx`). Optional rather than
    // required so it renders outside the shell, like the sign-in pages; the page sends a guest to sign in and back.
    auth: 'optional',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/device.js'),
    name: 'device',
    path: '/device',
  },
]);

const routes: readonly AppClientRouteContribution[] = [
  appRoutes,
  systemSettingsRoutes,
];

export default routes;
