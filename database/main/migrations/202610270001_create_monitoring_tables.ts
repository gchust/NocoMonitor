import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * NocoMonitor's core tables.
 *
 * - `mnServices`: what people think of as one product (CRM, ITAM, …); a status page lists services.
 * - `mnMonitors`: one probe of a service, with its schedule, assertions and current state.
 * - `mnChecks`: the raw result of every probe, kept for a bounded retention window.
 * - `mnDailyStats`: per-monitor daily rollup of `mnChecks`, which the 90-day uptime bars read.
 * - `mnIncidents` / `mnIncidentUpdates`: incidents and their timeline, including what agents wrote.
 * - `mnStatusPages`: public status pages and the services each shows.
 *
 * Timestamps are `datetimeTz`: absolute instants, never a wall clock the host timezone would reinterpret.
 *
 * Ids are Snowflake strings: a Snowflake number exceeds JavaScript's safe integer range, and SQLite hands bigints back
 * as numbers.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610270001_create_monitoring_tables',

  async up({ builder }) {
    await builder.createCollection('mnServices', (c) => {
      c.string('id', { length: 32 }).notNull();
      c.string('name', { length: 255 }).notNull();
      c.string('slug', { length: 128 }).notNull();
      c.text('description').nullable();
      c.string('groupName', { length: 255 }).nullable();
      c.string('repoUrl', { length: 512 }).nullable();
      c.text('runbook').nullable();
      c.integer('sortOrder').notNull().defaultTo(0);
      c.datetimeTz('createdAt').notNull();
      c.datetimeTz('updatedAt').notNull();
      c.primary('id', { name: 'pk_mn_services' });
      c.unique('slug', { name: 'uq_mn_services_slug' });
    });

    await builder.createCollection('mnMonitors', (c) => {
      c.string('id', { length: 32 }).notNull();
      c.string('serviceId', { length: 32 }).notNull();
      c.string('name', { length: 255 }).notNull();
      c.string('type', { length: 32 }).notNull();
      c.string('region', { length: 64 }).nullable();
      c.text('url').notNull();
      c.string('method', { length: 16 }).notNull().defaultTo('GET');
      c.json('headers').nullable();
      c.text('body').nullable();
      c.string('expectedStatus', { length: 64 }).notNull().defaultTo('200-299');
      c.string('keyword', { length: 512 }).nullable();
      c.string('jsonPath', { length: 255 }).nullable();
      c.string('jsonExpected', { length: 512 }).nullable();
      c.integer('intervalSec').notNull().defaultTo(60);
      c.integer('timeoutMs').notNull().defaultTo(10000);
      c.integer('degradedLatencyMs').nullable();
      c.integer('failureThreshold').notNull().defaultTo(2);
      c.integer('recoveryThreshold').notNull().defaultTo(2);
      c.boolean('enabled').notNull().defaultTo(true);
      c.boolean('autoDiagnose').notNull().defaultTo(true);
      c.string('remediationLevel', { length: 16 }).notNull().defaultTo('off');
      c.string('status', { length: 16 }).notNull().defaultTo('pending');
      c.datetimeTz('statusChangedAt').nullable();
      c.datetimeTz('lastCheckedAt').nullable();
      c.datetimeTz('nextCheckAt').nullable();
      c.integer('lastLatencyMs').nullable();
      c.integer('lastHttpStatus').nullable();
      c.text('lastError').nullable();
      c.integer('consecutiveFailures').notNull().defaultTo(0);
      c.integer('consecutiveSuccesses').notNull().defaultTo(0);
      c.integer('sortOrder').notNull().defaultTo(0);
      c.datetimeTz('createdAt').notNull();
      c.datetimeTz('updatedAt').notNull();
      c.primary('id', { name: 'pk_mn_monitors' });
      c.index('serviceId', { name: 'ix_mn_monitors_service_id' });
      c.index(['enabled', 'nextCheckAt'], { name: 'ix_mn_monitors_due' });
    });

    await builder.createCollection('mnChecks', (c) => {
      c.string('id', { length: 32 }).notNull();
      c.string('monitorId', { length: 32 }).notNull();
      c.datetimeTz('checkedAt').notNull();
      c.string('status', { length: 16 }).notNull();
      c.integer('latencyMs').nullable();
      c.integer('httpStatus').nullable();
      c.text('error').nullable();
      c.json('details').nullable();
      c.primary('id', { name: 'pk_mn_checks' });
      c.index(['monitorId', 'checkedAt'], { name: 'ix_mn_checks_monitor_time' });
      c.index('checkedAt', { name: 'ix_mn_checks_checked_at' });
    });

    await builder.createCollection('mnDailyStats', (c) => {
      c.string('id', { length: 32 }).notNull();
      c.string('monitorId', { length: 32 }).notNull();
      c.string('day', { length: 10 }).notNull();
      c.integer('total').notNull().defaultTo(0);
      c.integer('upCount').notNull().defaultTo(0);
      c.integer('degradedCount').notNull().defaultTo(0);
      c.integer('downCount').notNull().defaultTo(0);
      c.double('latencySum').notNull().defaultTo(0);
      c.integer('latencyCount').notNull().defaultTo(0);
      c.primary('id', { name: 'pk_mn_daily_stats' });
      c.unique(['monitorId', 'day'], { name: 'uq_mn_daily_stats_monitor_day' });
    });

    await builder.createCollection('mnIncidents', (c) => {
      c.string('id', { length: 32 }).notNull();
      c.string('serviceId', { length: 32 }).notNull();
      c.string('monitorId', { length: 32 }).nullable();
      c.string('title', { length: 512 }).notNull();
      c.string('status', { length: 16 }).notNull();
      c.string('severity', { length: 16 }).notNull();
      c.string('source', { length: 16 }).notNull();
      c.boolean('publicVisible').notNull().defaultTo(true);
      c.datetimeTz('startedAt').notNull();
      c.datetimeTz('resolvedAt').nullable();
      c.string('aiState', { length: 16 }).notNull().defaultTo('none');
      c.string('aiRunId', { length: 64 }).nullable();
      c.text('aiSummary').nullable();
      c.text('aiRootCause').nullable();
      c.string('aiConfidence', { length: 16 }).nullable();
      c.json('aiSuggestedActions').nullable();
      c.datetimeTz('aiUpdatedAt').nullable();
      c.string('createdById', { length: 64 }).nullable();
      c.datetimeTz('createdAt').notNull();
      c.datetimeTz('updatedAt').notNull();
      c.primary('id', { name: 'pk_mn_incidents' });
      c.index(['status', 'startedAt'], { name: 'ix_mn_incidents_status_started' });
      c.index('serviceId', { name: 'ix_mn_incidents_service_id' });
      c.index('monitorId', { name: 'ix_mn_incidents_monitor_id' });
    });

    await builder.createCollection('mnIncidentUpdates', (c) => {
      c.string('id', { length: 32 }).notNull();
      c.string('incidentId', { length: 32 }).notNull();
      c.string('kind', { length: 16 }).notNull();
      c.string('status', { length: 16 }).nullable();
      c.text('body').notNull();
      c.string('authorType', { length: 16 }).notNull();
      c.string('authorId', { length: 64 }).nullable();
      c.string('authorName', { length: 255 }).nullable();
      c.boolean('publicVisible').notNull().defaultTo(false);
      c.datetimeTz('createdAt').notNull();
      c.primary('id', { name: 'pk_mn_incident_updates' });
      c.index(['incidentId', 'createdAt'], {
        name: 'ix_mn_incident_updates_incident_created',
      });
    });

    await builder.createCollection('mnStatusPages', (c) => {
      c.string('id', { length: 32 }).notNull();
      c.string('slug', { length: 128 }).notNull();
      c.string('title', { length: 255 }).notNull();
      c.text('description').nullable();
      c.json('serviceIds').notNull();
      c.boolean('published').notNull().defaultTo(true);
      c.datetimeTz('createdAt').notNull();
      c.datetimeTz('updatedAt').notNull();
      c.primary('id', { name: 'pk_mn_status_pages' });
      c.unique('slug', { name: 'uq_mn_status_pages_slug' });
    });
  },

  async down({ builder }) {
    await builder.dropCollection('mnStatusPages');
    await builder.dropCollection('mnIncidentUpdates');
    await builder.dropCollection('mnIncidents');
    await builder.dropCollection('mnDailyStats');
    await builder.dropCollection('mnChecks');
    await builder.dropCollection('mnMonitors');
    await builder.dropCollection('mnServices');
  },
});

export default migration;
