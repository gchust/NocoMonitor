import path from 'node:path';
import type { MigrationSource } from '@nocobase/db';
import { describeMigration } from '@nocobase/app-testing/server';
import { expect } from 'vitest';

const sources: readonly MigrationSource[] = [
  {
    packageName: 'incident-first-diagnosis-test',
    directory: path.resolve(
      import.meta.dirname,
      '../../database/main/migrations',
    ),
  },
];

const at = (minute: number) => new Date(Date.UTC(2026, 9, 27, 10, minute));

// The time to the first root cause, filled for incidents diagnosed before the field from their timelines.
describeMigration('202610280003_add_incident_first_diagnosis', {
  sources,
  before: async ({ connection }) => {
    const incident = (id: string) => ({
      id,
      serviceId: 'svc-1',
      title: `Incident ${id}`,
      status: 'investigating',
      severity: 'major',
      source: 'auto',
      publicVisible: false,
      startedAt: at(0),
      aiState: 'completed',
      createdAt: at(0),
      updatedAt: at(0),
    });
    await connection.query
      .insertInto('mnIncidents')
      .values([incident('diagnosed'), incident('never')])
      .execute();
    const update = (id: string, kind: string, minute: number) => ({
      id,
      incidentId: 'diagnosed',
      kind,
      body: kind,
      authorType: 'agent',
      publicVisible: false,
      createdAt: at(minute),
    });
    await connection.query
      .insertInto('mnIncidentUpdates')
      .values([
        update('u-3', 'diagnosis', 50),
        update('u-1', 'status', 1),
        update('u-2', 'diagnosis', 3),
      ])
      .execute();
  },
  up: async ({ connection, expectCollection }) => {
    await expectCollection('mnIncidents').toHaveField('aiFirstDiagnosedAt', {
      nullable: true,
    });
    const rows = await connection.query
      .selectFrom('mnIncidents')
      .select(['id', 'aiFirstDiagnosedAt'])
      .orderBy('id', 'asc')
      .execute();
    expect(
      rows.map((row) => [
        row.id,
        row.aiFirstDiagnosedAt === null
          ? null
          : new Date(row.aiFirstDiagnosedAt as string | Date).toISOString(),
      ]),
    ).toEqual([
      ['diagnosed', at(3).toISOString()],
      ['never', null],
    ]);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('mnIncidents').not.toHaveField('aiFirstDiagnosedAt');
  },
});
