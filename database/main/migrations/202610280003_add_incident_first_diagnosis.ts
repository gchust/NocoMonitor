import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * `mnIncidents.aiFirstDiagnosedAt`: when the agent first recorded a diagnosis, for the time it took to find the root
 * cause. `aiUpdatedAt` moves with every later diagnosis, so a diagnosis asked for again hours later read as hours to
 * the root cause. Filled from the first diagnosis entry on each incident's timeline.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610280003_add_incident_first_diagnosis',

  async up({ builder, query }) {
    await builder.addField('mnIncidents', {
      name: 'aiFirstDiagnosedAt',
      type: 'datetimeTz',
      nullable: true,
    });

    const diagnoses = await query
      .selectFrom('mnIncidentUpdates')
      .select(['incidentId', 'createdAt'])
      .where('kind', '=', 'diagnosis')
      .orderBy('createdAt', 'asc')
      .execute();
    const first = new Map<string, unknown>();
    for (const row of diagnoses)
      if (!first.has(String(row.incidentId)))
        first.set(String(row.incidentId), row.createdAt);
    // One statement per diagnosed incident: a correlated `min()` subquery in `set` is not portable across dialects here.
    for (const [incidentId, at] of first)
      await query
        .updateTable('mnIncidents')
        .set({ aiFirstDiagnosedAt: at })
        .where('id', '=', incidentId)
        .execute();
  },

  async down({ builder }) {
    await builder.dropField('mnIncidents', 'aiFirstDiagnosedAt');
  },
});

export default migration;
