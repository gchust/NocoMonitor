import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * `mnIncidents.groupId`: the incident a probe-opened incident joined because it failed together with it — the same
 * service, or a monitor of the same host, within minutes. Null for an incident that leads its group or stands alone.
 * One diagnosis and one alert cover the group, and resolving the incident that leads it resolves the rest.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610280002_add_incident_group',

  async up({ builder }) {
    await builder.addField('mnIncidents', {
      name: 'groupId',
      type: 'string',
      length: 32,
      nullable: true,
      index: true,
    });
  },

  async down({ builder }) {
    await builder.dropField('mnIncidents', 'groupId');
  },
});

export default migration;
