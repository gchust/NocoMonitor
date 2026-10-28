import type { DatabaseManager } from '@nocobase/db';

import type {
  IncidentRecord,
  IncidentUpdateRecord,
  RemediationRecord,
} from './types.js';

const DAY_MS = 86_400_000;
/** Lists on the dashboard show this many rows; the counts are not capped. */
const LIST_LIMIT = 10;
/** Incidents read for one window's statistics: far more than a week of a healthy installation opens. */
const WINDOW_LIMIT = 500;

export interface AttentionItem {
  kind: 'approval' | 'diagnosisFailed';
  incidentId: string;
  incidentTitle: string;
  at: Date;
  actionTitle: string | null;
}

export interface FeedItem {
  id: string;
  kind: 'diagnosis' | 'remediation';
  authorType: IncidentUpdateRecord['authorType'];
  incidentId: string;
  incidentTitle: string;
  at: Date;
  text: string;
}

export interface BriefingStats {
  incidents: number;
  diagnosed: number;
  medianTimeToDiagnosisMs: number | null;
  fixesRequested: number;
  fixesVerified: number;
  needsYou: number;
}

export interface Briefing {
  since: Date;
  stats: BriefingStats;
  needsYou: AttentionItem[];
  /** Every fix waiting for approval on an open incident, uncapped, for the incident cards' state. */
  pendingFixes: { incidentId: string; actionTitle: string }[];
  feed: FeedItem[];
}

/**
 * What the AI did over the last `days` and what waits on people now: the overview's AI on-call card. A fixed number of
 * queries whatever the number of incidents.
 */
export async function readBriefing(
  db: DatabaseManager,
  input: {
    days: number;
    now?: Date;
    /** A drill's service: its incidents still wait on people, but count in no statistic and no feed. */
    excludeServiceId?: string | null;
  },
): Promise<Briefing> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - input.days * DAY_MS);
  const incidents = db.repository<IncidentRecord>('mnIncidents');
  const updates = db.repository<IncidentUpdateRecord>('mnIncidentUpdates');
  const remediations = db.repository<RemediationRecord>('mnRemediations');

  const excluded = input.excludeServiceId ?? null;
  const [openedRows, open, pending, requestedRows, allFeedRows] =
    await Promise.all([
      incidents.findMany({
        filter: (f) => f.date('startedAt').notBefore(since),
        sort: (s) => s.field('startedAt').desc(),
        limit: WINDOW_LIMIT,
      }),
      incidents.findMany({
        filter: (f) => f.string('status').ne('resolved'),
        sort: (s) => s.field('startedAt').desc(),
        limit: WINDOW_LIMIT,
      }),
      remediations.findMany({
        filter: (f) => f.string('status').eq('pending'),
        sort: (s) => s.field('createdAt').desc(),
        limit: WINDOW_LIMIT,
      }),
      remediations.findMany({
        filter: (f) =>
          f.and([
            f.date('createdAt').notBefore(since),
            f.string('requestedByType').eq('agent'),
          ]),
        limit: WINDOW_LIMIT,
      }),
      updates.findMany({
        filter: (f) =>
          f.and([
            f.date('createdAt').notBefore(since),
            f.or([
              f.string('kind').eq('diagnosis'),
              f.string('kind').eq('remediation'),
            ]),
          ]),
        sort: (s) => s.field('createdAt').desc(),
        limit: LIST_LIMIT,
      }),
    ]);

  const opened = openedRows.filter((row) => row.serviceId !== excluded);
  const requested = requestedRows.filter((row) => row.serviceId !== excluded);
  // Updates carry no service: a drill's are told apart by its incidents, read only while a drill exists.
  const drillIncidents = new Set(
    excluded
      ? (
          await db
            .query()
            .selectFrom('mnIncidents')
            .select('id')
            .where('serviceId', '=', excluded)
            .execute()
        ).map((row) => String(row.id))
      : [],
  );
  const feedRows = allFeedRows.filter(
    (row) => !drillIncidents.has(row.incidentId),
  );

  // The first diagnosis of each incident opened in the window, for the time it took.
  const firstDiagnosis = new Map<string, Date>();
  if (opened.length) {
    const diagnoses = await db
      .query()
      .selectFrom('mnIncidentUpdates')
      .select(['incidentId', 'createdAt'])
      .where('kind', '=', 'diagnosis')
      .where(
        'incidentId',
        'in',
        opened.map((incident) => incident.id),
      )
      .orderBy('createdAt', 'asc')
      .execute();
    for (const update of diagnoses) {
      const id = String(update.incidentId);
      if (!firstDiagnosis.has(id))
        firstDiagnosis.set(id, new Date(update.createdAt as string | Date));
    }
  }

  const openById = new Map(open.map((incident) => [incident.id, incident]));
  const needsYou: AttentionItem[] = [
    // A fix waiting on a resolved incident waits on no one: resolving settles it.
    ...pending
      .filter((remediation) => openById.has(remediation.incidentId))
      .map((remediation) => ({
        kind: 'approval' as const,
        incidentId: remediation.incidentId,
        incidentTitle: openById.get(remediation.incidentId)!.title,
        at: new Date(remediation.createdAt),
        actionTitle: remediation.actionTitle,
      })),
    ...open
      .filter((incident) => incident.aiState === 'failed')
      .map((incident) => ({
        kind: 'diagnosisFailed' as const,
        incidentId: incident.id,
        incidentTitle: incident.title,
        at: new Date(incident.aiUpdatedAt ?? incident.updatedAt),
        actionTitle: null,
      })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  // Titles of the feed's incidents that are neither open nor opened in the window.
  const titles = new Map<string, string>(
    [...opened, ...open].map((incident) => [incident.id, incident.title]),
  );
  const missing = [
    ...new Set(
      feedRows.map((row) => row.incidentId).filter((id) => !titles.has(id)),
    ),
  ];
  if (missing.length)
    for (const incident of await incidents.findMany({
      filter: (f) => f.or(missing.map((id) => f.string('id').eq(id))),
    }))
      titles.set(incident.id, incident.title);

  const times = opened
    .filter((incident) => firstDiagnosis.has(incident.id))
    .map(
      (incident) =>
        firstDiagnosis.get(incident.id)!.getTime() -
        new Date(incident.startedAt).getTime(),
    )
    .filter((ms) => ms >= 0);

  return {
    since,
    stats: {
      incidents: opened.length,
      diagnosed: opened.filter((incident) => firstDiagnosis.has(incident.id))
        .length,
      medianTimeToDiagnosisMs: median(times),
      fixesRequested: requested.length,
      fixesVerified: requested.filter(
        (remediation) => remediation.status === 'verified',
      ).length,
      needsYou: needsYou.length,
    },
    needsYou: needsYou.slice(0, LIST_LIMIT),
    pendingFixes: needsYou
      .filter((item) => item.kind === 'approval')
      .map((item) => ({
        incidentId: item.incidentId,
        actionTitle: item.actionTitle ?? '',
      })),
    feed: feedRows
      .filter((row) => titles.has(row.incidentId))
      .map((row) => ({
        id: row.id,
        kind: row.kind as FeedItem['kind'],
        authorType: row.authorType,
        incidentId: row.incidentId,
        incidentTitle: titles.get(row.incidentId)!,
        at: new Date(row.createdAt),
        text: row.body.split('\n')[0].slice(0, 200),
      })),
  };
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
