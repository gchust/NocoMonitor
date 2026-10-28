import { useTranslation } from '@nocobase/i18n/client';

import {
  formatDateTime,
  formatDuration,
  formatRelative,
  type Incident,
  type Remediation,
  type RemediationLevel,
} from '../../lib/monitoring.js';
import { useCanManage } from './utils.js';

export type PipelineStepKey = 'detect' | 'diagnose' | 'fix' | 'verify';
export type PipelineStepState =
  'done' | 'active' | 'waiting' | 'failed' | 'skipped' | 'pending';

export interface PipelineStep {
  key: PipelineStepKey;
  state: PipelineStepState;
  /** One line on where the step stands, in words: the state is never told by color alone. */
  text: string;
}

/**
 * Where an incident's automatic response stands: detected, diagnosed by the agent, fixed, verified by the probes.
 *
 * `remediations` (newest first, as `GET /incidents/:id/remediations` answers) and `level` are known on the incident
 * page; the overview only knows which incidents have a fix waiting for approval (`pendingFix`), so its later steps
 * stay vaguer.
 */
export function usePipelineSteps({
  incident,
  remediations,
  level,
  pendingFix,
}: {
  readonly incident: Incident;
  readonly remediations?: readonly Remediation[];
  readonly level?: RemediationLevel;
  readonly pendingFix?: string | null;
}): PipelineStep[] {
  const { t, i18n } = useTranslation();
  // Only someone who may approve is told the fix waits for them.
  const canDecide = useCanManage();
  const latest = remediations?.[0];
  const p = (key: string, values?: Record<string, unknown>): string =>
    t(`monitoring.pipeline.${key}`, values);

  const detect: PipelineStep = {
    key: 'detect',
    state: 'done',
    text: p(`detect.${incident.source === 'manual' ? 'manual' : 'auto'}`, {
      when: formatDateTime(incident.startedAt, i18n.language),
    }),
  };

  const diagnose: PipelineStep = {
    key: 'diagnose',
    ...(
      {
        none: { state: 'pending', text: p('diagnose.none') },
        queued: { state: 'active', text: p('diagnose.queued') },
        running: { state: 'active', text: p('diagnose.running') },
        completed: {
          state: 'done',
          text: incident.aiUpdatedAt
            ? p('diagnose.completed', {
                duration: formatDuration(
                  incident.startedAt,
                  incident.aiUpdatedAt,
                  i18n.language,
                ),
              })
            : p('diagnose.completedNoTime'),
        },
        failed: { state: 'failed', text: p('diagnose.failed') },
      } as const
    )[incident.aiState],
  };

  let fix: PipelineStep;
  const action = latest?.actionTitle ?? pendingFix ?? '';
  if (pendingFix || latest?.status === 'pending')
    fix = {
      key: 'fix',
      state: 'waiting',
      text: p(canDecide ? 'fix.pending' : 'fix.pendingOthers'),
    };
  else if (latest?.status === 'running')
    fix = { key: 'fix', state: 'active', text: p('fix.running', { action }) };
  else if (
    latest?.status === 'verifying' ||
    latest?.status === 'verified' ||
    latest?.status === 'unverified'
  )
    fix = { key: 'fix', state: 'done', text: p('fix.applied', { action }) };
  else if (latest?.status === 'failed')
    fix = { key: 'fix', state: 'failed', text: p('fix.failed') };
  else if (latest?.status === 'rejected')
    fix = { key: 'fix', state: 'skipped', text: p('fix.rejected') };
  else if (level === 'off' || level === 'suggest')
    fix = { key: 'fix', state: 'skipped', text: p(`fix.${level}`) };
  else if (remediations && incident.aiState === 'completed')
    fix = { key: 'fix', state: 'skipped', text: p('fix.none') };
  else fix = { key: 'fix', state: 'pending', text: p('fix.notYet') };

  let verify: PipelineStep;
  if (latest?.status === 'verifying')
    verify = { key: 'verify', state: 'active', text: p('verify.verifying') };
  else if (latest?.status === 'verified')
    verify = { key: 'verify', state: 'done', text: p('verify.verified') };
  else if (latest?.status === 'unverified')
    verify = { key: 'verify', state: 'failed', text: p('verify.unverified') };
  else if (incident.status === 'resolved')
    verify = {
      key: 'verify',
      state: 'done',
      text: p('verify.recovered', {
        when: formatRelative(incident.resolvedAt, i18n.language),
      }),
    };
  else verify = { key: 'verify', state: 'pending', text: p('verify.notYet') };

  return [detect, diagnose, fix, verify];
}
