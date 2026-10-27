import { defineSeed } from '@nocobase/db';

/**
 * The first services NocoMonitor watches: the NocoBase solution applications, each deployed in two regions. Every
 * application is a NocoBase 3 app, so each region gets two monitors — the framework's `/api/healthz` (which answers
 * `{ ok: true }` without a session) and the browser page, which must contain the SPA's mount point.
 *
 * Records use fixed ids so the seed is idempotent: a repeated run updates nothing a person may have changed except
 * through `update`, which only refreshes descriptive fields.
 */
const regions = [
  { key: 'global', label: 'Global', origin: 'https://solutions.nocobase.com' },
  { key: 'cn', label: 'China', origin: 'https://solutions-cn.nocobase.com' },
] as const;

const services = [
  {
    key: 'crm',
    name: 'NocoCRM',
    description: 'Customer relationship management built on NocoBase 3.',
    repoUrl: 'https://github.com/nocobase/NocoCRM',
    sortOrder: 10,
  },
  {
    key: 'itam',
    name: 'NocoITAM',
    description: 'IT asset management built on NocoBase 3.',
    repoUrl: 'https://github.com/nocobase/NocoITAM',
    sortOrder: 20,
  },
  {
    key: 'reach',
    name: 'NocoReach',
    description: 'Growth and outreach workspace built on NocoBase 3.',
    repoUrl: 'https://github.com/nocobase/NocoReach',
    sortOrder: 30,
  },
] as const;

export default defineSeed({
  name: '202610270002_nocobase_solutions_targets',

  async run({ repository }) {
    const now = new Date();
    for (const service of services) {
      const serviceId = `seed-${service.key}`;
      await repository('mnServices').upsertOne({
        filter: { id: serviceId },
        create: {
          id: serviceId,
          name: service.name,
          slug: service.key,
          description: service.description,
          groupName: 'NocoBase Solutions',
          repoUrl: service.repoUrl,
          sortOrder: service.sortOrder,
          createdAt: now,
          updatedAt: now,
        },
        update: { repoUrl: service.repoUrl },
      });

      let order = 0;
      for (const region of regions) {
        const base = `${region.origin}/${service.key}`;
        const monitors = [
          {
            id: `seed-${service.key}-${region.key}-api`,
            name: `${service.name} API (${region.label})`,
            type: 'json',
            url: `${base}/api/healthz`,
            jsonPath: 'ok',
            jsonExpected: 'true',
            keyword: null,
          },
          {
            id: `seed-${service.key}-${region.key}-web`,
            name: `${service.name} Web (${region.label})`,
            type: 'keyword',
            url: base,
            jsonPath: null,
            jsonExpected: null,
            keyword: '<div id="root"',
          },
        ];
        for (const monitor of monitors) {
          order += 1;
          await repository('mnMonitors').upsertOne({
            filter: { id: monitor.id },
            create: {
              ...monitor,
              serviceId,
              region: region.label,
              method: 'GET',
              expectedStatus: '200-299',
              intervalSec: 60,
              timeoutMs: 15000,
              degradedLatencyMs: 3000,
              failureThreshold: 2,
              recoveryThreshold: 2,
              enabled: true,
              autoDiagnose: true,
              remediationLevel: 'off',
              status: 'pending',
              consecutiveFailures: 0,
              consecutiveSuccesses: 0,
              sortOrder: order,
              createdAt: now,
              updatedAt: now,
            },
            update: { url: monitor.url },
          });
        }
      }
    }

    await repository('mnStatusPages').upsertOne({
      filter: { slug: 'nocobase-solutions' },
      create: {
        id: 'seed-nocobase-solutions',
        slug: 'nocobase-solutions',
        title: 'NocoBase Solutions Status',
        description: 'Live availability of the NocoBase solution applications.',
        serviceIds: services.map((service) => `seed-${service.key}`),
        published: true,
        createdAt: now,
        updatedAt: now,
      },
      update: { title: 'NocoBase Solutions Status' },
    });
  },
});
