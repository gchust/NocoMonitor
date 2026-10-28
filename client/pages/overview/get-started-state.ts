import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';

import {
  formatDuration,
  type AiBriefing,
  type DrillStatus,
} from '../../lib/monitoring.js';
import type { PipelineStep } from '../monitoring/pipeline-steps.js';

const STORAGE_PREFIX = 'nocomonitor:get-started:';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage keep the choice for this visit only.
  }
}

/**
 * What this viewer last saw of Getting started — hidden, all done, or neither — kept per signed-in user in this browser:
 * a convenience, so storage failures only reset it. "Done" lets the page skip the card's placeholder while it loads.
 */
export function useGetStartedMemory(): {
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  knownDone: boolean;
  setKnownDone: (done: boolean) => void;
} {
  const userId = useAuthentication().session?.user.id ?? 'anonymous';
  const key = `${STORAGE_PREFIX}${userId}`;
  const [state, setState] = useState(() => ({ key, value: read(key) }));
  // Another account signed in on this browser reads its own choice.
  const value = state.key === key ? state.value : read(key);
  const set = (next: string | null): void => {
    write(key, next);
    setState({ key, value: next });
  };
  return {
    hidden: value === 'hidden',
    setHidden: (hidden) => set(hidden ? 'hidden' : null),
    knownDone: value === 'done',
    setKnownDone: (done) => {
      if (done !== (value === 'done') && value !== 'hidden')
        set(done ? 'done' : null);
    },
  };
}

export type StartStepKey = 'agent' | 'monitor' | 'drill';

export interface StartStep {
  key: StartStepKey;
  done: boolean;
}

/** The three steps of getting started, from what the application already has. */
export function startSteps({
  agent,
  ownMonitors,
  drill,
}: {
  readonly agent: AiBriefing['agent'] | undefined;
  readonly ownMonitors: number;
  readonly drill: DrillStatus | undefined;
}): StartStep[] {
  return [
    {
      key: 'agent',
      done: Boolean(agent?.configured && agent.online),
    },
    { key: 'monitor', done: ownMonitors > 0 },
    { key: 'drill', done: Boolean(drill?.completedOnce) },
  ];
}

/** The drill's automatic response as the pipeline shows it, with times taken from the drill's start. */
export function useDrillSteps(
  drill: DrillStatus,
  agentReady: boolean,
): PipelineStep[] {
  const { t, i18n } = useTranslation();
  const p = (key: string, values?: Record<string, unknown>): string =>
    t(`monitoring.pipeline.${key}`, values);
  const since = (from: string | null, to: string | null): string =>
    from && to ? formatDuration(from, to, i18n.language) : '';

  const detect: PipelineStep = drill.detectedAt
    ? {
        key: 'detect',
        state: 'done',
        text: t('monitoring.pipeline.detect.drill', {
          duration: since(drill.startedAt, drill.detectedAt),
        }),
      }
    : drill.targetUnreachable
      ? { key: 'detect', state: 'failed', text: p('detect.unreachable') }
      : {
          key: 'detect',
          state: 'active',
          text: t('monitoring.drill.waitingCheck'),
        };

  let diagnose: PipelineStep;
  if (!drill.detectedAt)
    diagnose = { key: 'diagnose', state: 'pending', text: p('diagnose.none') };
  else if (drill.diagnosedAt)
    diagnose = {
      key: 'diagnose',
      state: 'done',
      text: p('diagnose.completed', {
        duration: since(drill.detectedAt, drill.diagnosedAt),
      }),
    };
  else if (drill.aiState === 'failed')
    diagnose = { key: 'diagnose', state: 'failed', text: p('diagnose.failed') };
  else if (drill.aiState === 'queued' || drill.aiState === 'running')
    diagnose = {
      key: 'diagnose',
      state: 'active',
      text: p(`diagnose.${drill.aiState}`),
    };
  else if (!agentReady)
    diagnose = {
      key: 'diagnose',
      state: 'skipped',
      text: p('diagnose.notSetUp'),
    };
  else
    diagnose = { key: 'diagnose', state: 'pending', text: p('diagnose.none') };

  const action = drill.fix?.actionTitle ?? '';
  let fix: PipelineStep;
  switch (drill.fix?.status) {
    case 'pending':
      fix = { key: 'fix', state: 'waiting', text: p('fix.pending') };
      break;
    case 'running':
      fix = { key: 'fix', state: 'active', text: p('fix.running', { action }) };
      break;
    case 'verifying':
    case 'verified':
    case 'unverified':
      fix = { key: 'fix', state: 'done', text: p('fix.applied', { action }) };
      break;
    case 'failed':
      fix = { key: 'fix', state: 'failed', text: p('fix.failed') };
      break;
    case 'rejected':
      fix = { key: 'fix', state: 'skipped', text: p('fix.rejected') };
      break;
    default:
      fix = { key: 'fix', state: 'pending', text: p('fix.notYet') };
  }

  const verify: PipelineStep = drill.recoveredAt
    ? {
        key: 'verify',
        state: 'done',
        text: p('verify.recoveredIn', {
          duration: since(drill.startedAt, drill.recoveredAt),
        }),
      }
    : drill.fix?.status === 'verifying'
      ? { key: 'verify', state: 'active', text: p('verify.verifying') }
      : { key: 'verify', state: 'pending', text: p('verify.notYet') };

  return [detect, diagnose, fix, verify];
}
