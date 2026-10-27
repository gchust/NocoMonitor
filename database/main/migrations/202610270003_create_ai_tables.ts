import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * What the AI side of NocoMonitor keeps.
 *
 * - `mnSettings`: one row per settings key; `ai` names the diagnosis agent and the person whose permissions its runs
 *   use when no person started them (an incident opened by a probe).
 * - `mnServices.remediations`: the fixes a service allows, each a fixed HTTP call (a deploy hook, a restart endpoint).
 *   Agents choose among them by key; they never supply a URL or a command.
 * - `mnRemediations`: every fix an agent or a person asked for, its approval, its execution and whether the probes
 *   saw the service recover afterwards.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610270003_create_ai_tables',

  async up({ builder }) {
    await builder.createCollection('mnSettings', (c) => {
      c.string('key', { length: 64 }).notNull();
      c.json('value').notNull();
      c.string('updatedById', { length: 64 }).nullable();
      c.datetimeTz('updatedAt').notNull();
      c.primary('key', { name: 'pk_mn_settings' });
    });

    await builder.addField('mnServices', {
      name: 'remediations',
      type: 'json',
      nullable: true,
    });

    await builder.createCollection('mnRemediations', (c) => {
      c.string('id', { length: 32 }).notNull();
      c.string('incidentId', { length: 32 }).notNull();
      c.string('serviceId', { length: 32 }).notNull();
      c.string('monitorId', { length: 32 }).nullable();
      c.string('actionKey', { length: 64 }).notNull();
      c.string('actionTitle', { length: 255 }).notNull();
      c.text('reason').notNull();
      c.string('status', { length: 16 }).notNull();
      c.string('requestedByType', { length: 16 }).notNull();
      c.string('requestedByName', { length: 255 }).nullable();
      c.string('runId', { length: 64 }).nullable();
      c.string('decidedById', { length: 64 }).nullable();
      c.string('decidedByName', { length: 255 }).nullable();
      c.datetimeTz('decidedAt').nullable();
      c.datetimeTz('executedAt').nullable();
      c.integer('httpStatus').nullable();
      c.text('output').nullable();
      c.datetimeTz('verifyAt').nullable();
      c.datetimeTz('verifiedAt').nullable();
      c.datetimeTz('createdAt').notNull();
      c.datetimeTz('updatedAt').notNull();
      c.primary('id', { name: 'pk_mn_remediations' });
      c.index(['incidentId', 'createdAt'], { name: 'ix_mn_remediations_incident' });
      c.index(['status', 'verifyAt'], { name: 'ix_mn_remediations_verify' });
    });
  },

  async down({ builder }) {
    await builder.dropCollection('mnRemediations');
    await builder.dropField('mnServices', 'remediations');
    await builder.dropCollection('mnSettings');
  },
});

export default migration;
