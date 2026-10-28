import path from 'node:path';
import type { MigrationSource } from '@nocobase/db';
import { describeMigration } from '@nocobase/app-testing/server';
import { expect } from 'vitest';

const sources: readonly MigrationSource[] = [
  {
    packageName: 'setups-test',
    directory: path.resolve(
      import.meta.dirname,
      '../../database/main/migrations',
    ),
  },
];

// The conversations people set up monitoring through, with the agent.
describeMigration('202610280004_create_setups', {
  sources,
  up: async ({ connection, expectCollection }) => {
    await expectCollection('mnSetups').toHaveField('turns', {
      nullable: false,
    });
    await expectCollection('mnSetups').toHaveField('result', {
      nullable: true,
    });
    const now = new Date();
    await connection.query
      .insertInto('mnSetups')
      .values({
        id: 'setup-1',
        kind: 'monitors',
        state: 'queued',
        runId: 'run-1',
        language: 'en-US',
        turns: JSON.stringify([{ id: 't1', role: 'user', text: 'Monitor it' }]),
        createdById: 'user-1',
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const rows = await connection.query
      .selectFrom('mnSetups')
      .select(['id', 'runId', 'result'])
      .where('runId', '=', 'run-1')
      .execute();
    expect(rows).toEqual([{ id: 'setup-1', runId: 'run-1', result: null }]);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('mnSetups').not.toExist();
  },
});
