import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * `mnIncidents.aiVerdict`: whether the diagnosis agent judged the incident a real outage (`outage`) or a false alarm
 * (`falseAlarm`: the service works and the monitor, not the service, needs changing). Null until an agent records one,
 * and for diagnoses recorded before the field.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610280001_add_incident_ai_verdict',

  async up({ builder }) {
    await builder.addField('mnIncidents', {
      name: 'aiVerdict',
      type: 'string',
      length: 16,
      nullable: true,
    });
  },

  async down({ builder }) {
    await builder.dropField('mnIncidents', 'aiVerdict');
  },
});

export default migration;
