import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * `mnSetups`: monitoring set up by talking to an agent. A person says what to monitor, or what status page they want;
 * the agent requests the addresses itself, asks what it cannot find out, and proposes services, monitors and a status
 * page. Nothing is created until the person applies the proposal.
 *
 * - `turns`: the conversation, oldest first: each `{ id, role, at, text, questions, proposal, runId }`.
 * - `state`: `queued` or `running` while the agent works on the latest message, `replied` once it answered, `failed`
 *   when its run ended without an answer, `applied` once the person created what it proposed.
 * - `result`: the ids of what applying created.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610280004_create_setups',

  async up({ builder }) {
    await builder.createCollection('mnSetups', (c) => {
      c.string('id', { length: 32 }).notNull();
      c.string('kind', { length: 16 }).notNull();
      c.string('state', { length: 16 }).notNull();
      c.string('runId', { length: 64 }).nullable();
      c.string('language', { length: 16 }).notNull();
      c.json('turns').notNull();
      c.json('result').nullable();
      c.string('createdById', { length: 64 }).notNull();
      c.string('createdByName', { length: 255 }).nullable();
      c.datetimeTz('createdAt').notNull();
      c.datetimeTz('updatedAt').notNull();
      c.datetimeTz('appliedAt').nullable();
      c.primary('id', { name: 'pk_mn_setups' });
      c.index(['runId'], { name: 'ix_mn_setups_run' });
      c.index(['createdById', 'updatedAt'], { name: 'ix_mn_setups_creator' });
    });
  },

  async down({ builder }) {
    await builder.dropCollection('mnSetups');
  },
});

export default migration;
