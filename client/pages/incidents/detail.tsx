import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  CheckIcon,
  CircleCheckIcon,
  LayersIcon,
  PencilIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { BackButton } from '#components/back-button';
import { LongText } from '#components/long-text';
import { PageContainer } from '#components/page-container';
import { RouteChildPage } from '#components/route-child-page';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Field, FieldGroup, FieldLabel } from '#components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Skeleton } from '#components/ui/skeleton';
import { Spinner } from '#components/ui/spinner';
import { Textarea } from '#components/ui/textarea';
import { cn } from 'cn';

import { useApiData } from '../../hooks/use-api-data.js';
import {
  formatDateTime,
  formatDuration,
  INCIDENT_STATUSES,
  type Incident,
  type IncidentStatus,
  type IncidentUpdate,
  type Monitor,
  type Remediation,
  type RemediationOptions,
  type Service,
} from '../../lib/monitoring.js';
import { AiPipeline } from '../monitoring/ai-pipeline.js';
import { usePipelineSteps } from '../monitoring/pipeline-steps.js';
import { ApproveFixDialog } from '../monitoring/approve-fix-dialog.js';
import {
  Fact,
  IncidentStatusBadge,
  LoadError,
  MonitorStatusBadge,
  SeverityBadge,
} from '../monitoring/components.js';
import { errorText, fixErrorText, useCanManage } from '../monitoring/utils.js';
import { SwitchField } from '../monitors/monitor-form.js';
import type { IncidentsOutletContext } from './index.js';
import { AiDiagnosisCard } from './ai-diagnosis-card.js';
import { IncidentTimeline } from './incident-timeline.js';
import { RemediationPanel } from './remediation-panel.js';
import { useDiagnose, type Diagnose } from './use-diagnose.js';

/** The one step of the automatic response that waits on the viewer. */
type NextStep = 'approval' | 'falseAlarm' | 'diagnose' | 'retry';

interface IncidentDetail {
  incident: Incident;
  service: Service | null;
  monitor: Monitor | null;
  updates: IncidentUpdate[];
  /** The incident leading this one's group (null when this one leads or stands alone), and those that joined it. */
  group: { lead: Incident | null; members: GroupedIncident[] };
}

interface GroupedIncident {
  id: string;
  title: string;
  status: IncidentStatus;
  monitorName: string | null;
}

export default function IncidentDetailPage(): ReactElement {
  const { incidentId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const parent = useOutletContext<IncidentsOutletContext>();
  const canManage = useCanManage();
  const path = `incidents/${encodeURIComponent(incidentId)}`;
  const detail = useApiData<{ data: IncidentDetail }>(path, undefined, {
    refreshMs: 10000,
  });
  const data = detail.data?.data;
  const incident = data?.incident;
  // An incident that joined a group is diagnosed with the one leading it: its AI side is the lead's.
  const lead = data?.group.lead ?? null;
  const diagnosed: Incident | undefined =
    incident && lead
      ? {
          ...incident,
          aiState: lead.aiState,
          aiRunId: lead.aiRunId,
          aiSummary: lead.aiSummary,
          aiRootCause: lead.aiRootCause,
          aiConfidence: lead.aiConfidence,
          aiVerdict: lead.aiVerdict,
          aiSuggestedActions: lead.aiSuggestedActions,
          aiUpdatedAt: lead.aiUpdatedAt,
        }
      : incident;

  // The fixes are read here, not in their panel: the automatic response card needs them too.
  const fixes = useApiData<{ data: RemediationOptions }>(
    `${path}/remediations`,
    undefined,
    { refreshMs: 10000 },
  );
  const fixOptions = fixes.data?.data;
  const pendingFix = fixOptions?.remediations.find(
    (item) => item.status === 'pending',
  );
  // The next step that waits on the viewer, which the response card offers as the page's primary action.
  const nextStep =
    !canManage || !incident || incident.status === 'resolved' || lead
      ? null
      : pendingFix
        ? 'approval'
        : incident.aiVerdict === 'falseAlarm' &&
            incident.aiState === 'completed'
          ? 'falseAlarm'
          : incident.aiState === 'none'
            ? 'diagnose'
            : incident.aiState === 'failed'
              ? 'retry'
              : null;

  const reload = (): void => {
    detail.reload();
    fixes.reload();
    parent.reload();
  };
  // One request at a time: both diagnose buttons share it and show it.
  const diagnosis = useDiagnose(incidentId, reload);

  return (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-6xl'>
        <BackButton />
        {detail.error && !data ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : null}
        {!data && detail.loading ? (
          <Skeleton className='h-64 rounded-xl' />
        ) : null}
        {incident && data ? (
          <>
            <header className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <IncidentStatusBadge status={incident.status} />
                <SeverityBadge severity={incident.severity} />
                <StatusBadge tone='neutral'>
                  {t(`monitoring.incidents.source.${incident.source}`)}
                </StatusBadge>
                {incident.publicVisible ? (
                  <StatusBadge tone='info'>
                    {t('monitoring.incidents.public')}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone='neutral'>
                    {t('monitoring.incidents.internal')}
                  </StatusBadge>
                )}
              </div>
              <h1 className='font-heading text-2xl font-semibold tracking-[-0.035em]'>
                {incident.title}
              </h1>
            </header>

            <dl className='grid gap-4 rounded-xl border p-4 sm:grid-cols-2 md:grid-cols-4'>
              <Fact label={t('monitoring.fields.service')}>
                {data.service?.name ?? '—'}
              </Fact>
              <Fact label={t('monitoring.fields.monitor')}>
                {data.monitor ? (
                  <Link
                    to={`/monitors/${data.monitor.id}`}
                    className='inline-flex items-center gap-2 hover:underline'
                  >
                    {data.monitor.name}
                    <MonitorStatusBadge status={data.monitor.status} />
                  </Link>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label={t('monitoring.incidents.started')}>
                {formatDateTime(incident.startedAt, i18n.language)}
              </Fact>
              <Fact label={t('monitoring.incidents.duration')}>
                {formatDuration(
                  incident.startedAt,
                  incident.resolvedAt,
                  i18n.language,
                )}
                {incident.resolvedAt
                  ? ''
                  : ` · ${t('monitoring.incidents.ongoing')}`}
              </Fact>
            </dl>

            <GroupCard
              lead={lead}
              members={data.group.members}
              resolved={incident.status === 'resolved'}
            />

            <ResponseCard
              incident={diagnosed ?? incident}
              monitorId={data.monitor?.id ?? null}
              fixes={fixOptions}
              pendingFix={pendingFix ?? null}
              nextStep={nextStep}
              diagnosis={diagnosis}
              onChanged={reload}
            />

            <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]'>
              <div className='space-y-6'>
                <AiDiagnosisCard
                  incident={diagnosed ?? incident}
                  // The lead's diagnosis is asked for on the lead's page.
                  canManage={canManage && !lead}
                  diagnosis={diagnosis}
                />
                {fixOptions ? (
                  <RemediationPanel
                    incidentId={incident.id}
                    data={fixOptions}
                    resolved={incident.status === 'resolved'}
                    canManage={canManage}
                    onChanged={reload}
                  />
                ) : null}
                <IncidentTimeline updates={data.updates} />
              </div>
              {canManage ? (
                <aside className='space-y-6'>
                  <PostUpdate
                    incident={incident}
                    path={path}
                    // One primary action per page: the response card's, while it offers one.
                    secondary={nextStep !== null}
                    onSaved={reload}
                  />
                  <IncidentSettings
                    incident={incident}
                    path={path}
                    onSaved={reload}
                  />
                </aside>
              ) : null}
            </div>
          </>
        ) : null}
      </PageContainer>
    </RouteChildPage>
  );
}

/**
 * The incidents opened together with this one: on the incident leading the group, those that joined it; on one that
 * joined, the incident it joined, which carries the diagnosis and the alerts.
 */
function GroupCard({
  lead,
  members,
  resolved,
}: {
  readonly lead: Incident | null;
  readonly members: readonly GroupedIncident[];
  readonly resolved: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  if (lead)
    return (
      <div className='flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center'>
        <LayersIcon className='size-5 shrink-0 text-primary' />
        <p className='min-w-0 flex-1 text-sm'>
          {t('monitoring.group.joined', { incident: lead.title })}
        </p>
        <Button
          variant='outline'
          size='sm'
          nativeButton={false}
          render={<Link to={`../${lead.id}`} relative='path' />}
        >
          {t('monitoring.group.openLead')}
        </Button>
      </div>
    );
  if (!members.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <LayersIcon className='size-5 text-primary' />
          {t('monitoring.group.title', { count: members.length })}
        </CardTitle>
        <CardDescription>
          {t(
            resolved
              ? 'monitoring.group.descriptionResolved'
              : 'monitoring.group.description',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='-mx-2 flex flex-col'>
          {members.map((member) => (
            <li key={member.id}>
              <Link
                to={`../${member.id}`}
                relative='path'
                className='flex flex-wrap items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted'
              >
                <IncidentStatusBadge status={member.status} />
                <span className='font-medium'>{member.title}</span>
                {member.monitorName ? (
                  <span className='text-muted-foreground'>
                    {member.monitorName}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Where the automatic response stands — detected, diagnosed, fixed, verified — and, for people who manage monitoring,
 * the one step that waits on them: approving the fix the agent asked for, or asking for a diagnosis.
 */
function ResponseCard({
  incident,
  fixes,
  pendingFix,
  nextStep,
  diagnosis,
  monitorId,
  onChanged,
}: {
  readonly incident: Incident;
  readonly fixes: RemediationOptions | undefined;
  readonly pendingFix: Remediation | null;
  readonly nextStep: NextStep | null;
  readonly monitorId: string | null;
  readonly diagnosis: Diagnose;
  readonly onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const { diagnose, asking } = diagnosis;
  const [approving, setApproving] = useState<Remediation | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [resolving, setResolving] = useState(false);
  // Deciding a fix removes the buttons that were focused: focus returns to this card, not to the page.
  const cardRef = useRef<HTMLDivElement>(null);
  const steps = usePipelineSteps({
    incident,
    remediations: fixes?.remediations,
    level: fixes?.level,
  });

  const reject = async (remediation: Remediation): Promise<void> => {
    setRejecting(true);
    try {
      await api.request({
        path: `remediations/${encodeURIComponent(remediation.id)}/reject`,
        method: 'POST',
        json: {},
      });
      toaster.show({ type: 'success', title: t('monitoring.fixes.rejected') });
      cardRef.current?.focus();
    } catch (error) {
      toaster.show({ type: 'error', title: fixErrorText(error, t) });
    } finally {
      setRejecting(false);
      onChanged();
    }
  };

  // Taking the agent's word that nothing is broken: resolve, with its summary as the closing update.
  const acceptFalseAlarm = async (): Promise<void> => {
    setResolving(true);
    try {
      await api.request({
        path: `incidents/${encodeURIComponent(incident.id)}/updates`,
        method: 'POST',
        json: {
          status: 'resolved',
          body: t('monitoring.ai.verdict.resolvedBody', {
            summary: incident.aiSummary ?? '',
          }),
          publicVisible: false,
        },
      });
      toaster.show({
        type: 'success',
        title: t('monitoring.ai.verdict.resolved'),
      });
      cardRef.current?.focus();
    } catch (error) {
      toaster.show({
        type: 'error',
        title: errorText(error, t('monitoring.errors.save')),
      });
    } finally {
      setResolving(false);
      onChanged();
    }
  };

  return (
    <Card ref={cardRef} tabIndex={-1} className='outline-none'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <SparklesIcon className='size-5 text-primary' />
          {t('monitoring.pipeline.title')}
        </CardTitle>
        <CardDescription>
          {t('monitoring.pipeline.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <AiPipeline steps={steps} />
        {nextStep ? (
          <div
            className={cn(
              'flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center',
              // The agent's all-clear reads as information, not as a warning.
              nextStep === 'falseAlarm'
                ? 'border-primary/20 bg-primary/5'
                : 'border-(--status-warning)/25 bg-(--status-warning-background)',
            )}
          >
            <div className='min-w-0 flex-1 text-sm'>
              {nextStep === 'approval' && pendingFix ? (
                <>
                  <p className='font-medium'>
                    {t('monitoring.pipeline.next.approval', {
                      action: pendingFix.actionTitle,
                    })}
                  </p>
                  <LongText className='mt-1 text-muted-foreground'>
                    {pendingFix.reason}
                  </LongText>
                </>
              ) : nextStep === 'falseAlarm' ? (
                <>
                  <p className='font-medium'>
                    {t('monitoring.pipeline.next.falseAlarm')}
                  </p>
                  <p className='mt-1 text-muted-foreground'>
                    {t('monitoring.pipeline.next.falseAlarmHint')}
                  </p>
                </>
              ) : (
                <p className='font-medium'>
                  {t(`monitoring.pipeline.next.${nextStep}`)}
                </p>
              )}
            </div>
            <div className='flex shrink-0 flex-wrap gap-2'>
              {nextStep === 'approval' && pendingFix ? (
                <>
                  <Button
                    variant='outline'
                    disabled={rejecting}
                    onClick={() => void reject(pendingFix)}
                  >
                    <XIcon data-icon='inline-start' />
                    {t('monitoring.fixes.reject')}
                  </Button>
                  <Button
                    disabled={rejecting}
                    onClick={() => setApproving(pendingFix)}
                  >
                    <CheckIcon data-icon='inline-start' />
                    {t('monitoring.fixes.approve')}
                  </Button>
                </>
              ) : nextStep === 'falseAlarm' ? (
                <>
                  {monitorId ? (
                    <Button
                      variant='outline'
                      nativeButton={false}
                      render={
                        <Link
                          to={`/monitors/${encodeURIComponent(monitorId)}?edit`}
                        />
                      }
                    >
                      <PencilIcon data-icon='inline-start' />
                      {t('monitoring.ai.verdict.editMonitor')}
                    </Button>
                  ) : null}
                  <Button
                    disabled={resolving}
                    onClick={() => void acceptFalseAlarm()}
                  >
                    {resolving ? (
                      <Spinner data-icon='inline-start' />
                    ) : (
                      <CircleCheckIcon data-icon='inline-start' />
                    )}
                    {t('monitoring.ai.verdict.accept')}
                  </Button>
                </>
              ) : (
                <Button disabled={asking} onClick={() => void diagnose()}>
                  {asking ? (
                    <Spinner data-icon='inline-start' />
                  ) : (
                    <SparklesIcon data-icon='inline-start' />
                  )}
                  {nextStep === 'retry'
                    ? t('monitoring.ai.diagnoseAgain')
                    : t('monitoring.ai.diagnose')}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
      <ApproveFixDialog
        remediation={approving}
        onClose={() => setApproving(null)}
        onDone={onChanged}
        approvedFocus={cardRef}
      />
    </Card>
  );
}

function PostUpdate({
  incident,
  path,
  secondary,
  onSaved,
}: {
  readonly incident: Incident;
  readonly path: string;
  readonly secondary: boolean;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<IncidentStatus | 'keep'>('keep');
  const [publicVisible, setPublicVisible] = useState(incident.publicVisible);
  const [busy, setBusy] = useState(false);
  const statusItems = [
    { value: 'keep', label: t('monitoring.incidents.keepStatus') },
    ...INCIDENT_STATUSES.filter((value) => value !== incident.status).map(
      (value) => ({
        value,
        label: t(`monitoring.incidentStatus.${value}`),
      }),
    ),
  ];

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.request({
        path: `${path}/updates`,
        method: 'POST',
        json: { body, publicVisible, ...(status === 'keep' ? {} : { status }) },
      });
      toaster.show({
        type: 'success',
        title: t('monitoring.incidents.posted'),
      });
      setBody('');
      setStatus('keep');
      onSaved();
    } catch (error) {
      toaster.show({
        type: 'error',
        title: errorText(error, t('monitoring.errors.save')),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('monitoring.incidents.postUpdate')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} className='space-y-4'>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-status`}>
                {t('monitoring.fields.status')}
              </FieldLabel>
              <Select
                items={statusItems}
                value={status}
                onValueChange={(value: string | null) =>
                  value && setStatus(value as IncidentStatus | 'keep')
                }
              >
                <SelectTrigger id={`${id}-status`} className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-body`}>
                {t('monitoring.incidents.message')}
              </FieldLabel>
              <Textarea
                id={`${id}-body`}
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
            <SwitchField
              id={`${id}-public`}
              label={t('monitoring.fields.publicVisible')}
              checked={publicVisible}
              onChange={setPublicVisible}
            />
          </FieldGroup>
          <Button
            type='submit'
            variant={secondary ? 'outline' : 'default'}
            className='w-full'
            disabled={busy || !body.trim()}
          >
            {busy
              ? t('monitoring.actions.saving')
              : t('monitoring.incidents.post')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function IncidentSettings({
  incident,
  path,
  onSaved,
}: {
  readonly incident: Incident;
  readonly path: string;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const patch = async (json: Record<string, unknown>): Promise<void> => {
    try {
      await api.request({ path, method: 'PATCH', json });
      onSaved();
    } catch (error) {
      toaster.show({
        type: 'error',
        title: errorText(error, t('monitoring.errors.save')),
      });
    }
  };
  const severityItems = (['minor', 'major', 'critical'] as const).map(
    (value) => ({
      value,
      label: t(`monitoring.severity.${value}`),
    }),
  );
  return (
    <Card size='sm'>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-severity`}>
              {t('monitoring.fields.severity')}
            </FieldLabel>
            <Select
              items={severityItems}
              value={incident.severity}
              onValueChange={(value: string | null) => {
                if (value) void patch({ severity: value });
              }}
            >
              <SelectTrigger id={`${id}-severity`} className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {severityItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <SwitchField
            id={`${id}-public`}
            label={t('monitoring.incidents.showOnStatusPage')}
            checked={incident.publicVisible}
            onChange={(checked) => void patch({ publicVisible: checked })}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
