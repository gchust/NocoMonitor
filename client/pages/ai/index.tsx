import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ActivityIcon,
  BotIcon,
  CheckCircle2Icon,
  FlaskConicalIcon,
  RadarIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from 'lucide-react';
import { useId, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#components/ui/empty';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '#components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Skeleton } from '#components/ui/skeleton';

import { useApiData } from '../../hooks/use-api-data.js';
import type {
  AiSettings,
  AvailableAgent,
  DiagnosisLanguage,
  DrillStatus,
  List,
} from '../../lib/monitoring.js';
import { LoadError } from '../monitoring/components.js';
import { useDrillAction } from '../monitoring/drill-dialog.js';
import { SwitchField } from '../monitors/monitor-form.js';
import { errorText, useCanManage } from '../monitoring/utils.js';

const STEPS = [
  { key: 'detect', icon: RadarIcon },
  { key: 'diagnose', icon: BotIcon },
  { key: 'remediate', icon: WrenchIcon },
  { key: 'verify', icon: ActivityIcon },
] as const;

/** Which agent diagnoses incidents, and how the AI part of monitoring works. */
export default function AiSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const settings = useApiData<{ data: AiSettings }>('monitoringAi/settings');
  const roster = useApiData<List<AvailableAgent>>(
    'agents/available',
    undefined,
    {
      refreshMs: 30000,
    },
  );

  return (
    <PageContainer className='mx-auto max-w-5xl'>
      <PageHeader
        title={t('monitoring.ai.settings.title')}
        description={t('monitoring.ai.settings.description')}
      />

      <ol className='grid gap-3 md:grid-cols-4'>
        {STEPS.map(({ key, icon: Icon }, index) => (
          <li key={key} className='rounded-xl border p-4'>
            <div className='flex items-center gap-2 text-sm font-medium'>
              <span className='flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary'>
                {index + 1}
              </span>
              <Icon className='size-4 text-muted-foreground' />
              {t(`monitoring.ai.settings.steps.${key}.title`)}
            </div>
            <p className='mt-2 text-xs leading-5 text-muted-foreground'>
              {t(`monitoring.ai.settings.steps.${key}.description`)}
            </p>
          </li>
        ))}
      </ol>

      {settings.error && !settings.data ? (
        <LoadError error={settings.error} onRetry={settings.reload} />
      ) : null}
      {!settings.data || !roster.data ? (
        <Skeleton className='h-64 rounded-xl' />
      ) : (
        <SettingsForm
          key={JSON.stringify(settings.data.data)}
          settings={settings.data.data}
          agents={roster.data.data}
          onSaved={settings.reload}
        />
      )}

      <DrillCard />

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <ShieldCheckIcon className='size-5 text-muted-foreground' />
            {t('monitoring.ai.settings.safetyTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className='list-disc space-y-1.5 pl-5 text-sm text-muted-foreground'>
            {(
              ['readOnly', 'whitelist', 'tiers', 'verify', 'runner'] as const
            ).map((key) => (
              <li key={key}>{t(`monitoring.ai.settings.safety.${key}`)}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

/**
 * A drill at any time, for people who manage monitoring: Getting started offers the first one, this the ones after it.
 * A started or running drill is followed on the overview, which shows its progress.
 */
function DrillCard(): ReactElement | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManage = useCanManage();
  const drill = useApiData<{ data: DrillStatus }>(
    canManage ? 'monitoringDrill' : null,
  );
  const { busy, ask, dialog } = useDrillAction({
    onDone: () => void navigate('/'),
    onSettled: drill.reload,
  });
  const status = drill.data?.data;
  if (!canManage || !status) return null;
  const running = status.state !== 'idle';

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <FlaskConicalIcon className='size-5 text-muted-foreground' />
          {t('monitoring.drill.practice.title')}
        </CardTitle>
        <CardDescription>
          {t(
            running
              ? 'monitoring.drill.practice.running'
              : 'monitoring.drill.practice.description',
          )}
        </CardDescription>
      </CardHeader>
      <CardFooter className='border-t pt-4'>
        {running ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to='/' />}
          >
            {t('monitoring.drill.show')}
          </Button>
        ) : (
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => ask('start')}
          >
            <FlaskConicalIcon data-icon='inline-start' />
            {t('monitoring.start.steps.drill.action')}
          </Button>
        )}
      </CardFooter>
      {dialog}
    </Card>
  );
}

function SettingsForm({
  settings,
  agents,
  onSaved,
}: {
  readonly settings: AiSettings;
  readonly agents: readonly AvailableAgent[];
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const canManage = useCanManage();
  const id = useId();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [agentId, setAgentId] = useState<string | null>(settings.agentId);
  const [language, setLanguage] = useState<DiagnosisLanguage | 'default'>(
    settings.language ?? 'default',
  );
  const languageItems = [
    { value: 'default', label: t('monitoring.ai.settings.languageDefault') },
    { value: 'zh-CN', label: t('monitoring.ai.settings.languages.zhCN') },
    { value: 'en-US', label: t('monitoring.ai.settings.languages.enUS') },
  ];
  const [busy, setBusy] = useState(false);
  const selected = agents.find((agent) => agent.id === agentId);
  const items = [
    ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
    // A configured agent no longer reported keeps its place, so saving does not silently drop it.
    ...(agentId && !selected
      ? [
          {
            value: agentId,
            label: t('monitoring.ai.settings.unavailableAgent'),
          },
        ]
      : []),
  ];

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.request({
        path: 'monitoringAi/settings',
        method: 'PUT',
        json: {
          enabled,
          agentId,
          language: language === 'default' ? null : language,
        },
      });
      toaster.show({
        type: 'success',
        title: t('monitoring.ai.settings.saved'),
      });
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

  if (!agents.length && !settings.agentId)
    return (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyTitle>{t('monitoring.ai.settings.noAgents')}</EmptyTitle>
          <EmptyDescription>
            {t('monitoring.ai.settings.noAgentsHint')}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className='flex-row justify-center gap-2'>
          <Button nativeButton={false} render={<Link to='/runtimes' />}>
            {t('monitoring.ai.settings.connectRuntime')}
          </Button>
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to='/agents' />}
          >
            {t('monitoring.ai.settings.openAgents')}
          </Button>
        </EmptyContent>
      </Empty>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('monitoring.ai.settings.agentTitle')}</CardTitle>
        <CardDescription>
          {settings.actorName
            ? t('monitoring.ai.settings.runsAs', { name: settings.actorName })
            : t('monitoring.ai.settings.runsAsYou')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-agent`}>
              {t('monitoring.ai.settings.agent')}
            </FieldLabel>
            <Select
              items={items}
              value={agentId}
              disabled={!canManage}
              onValueChange={(value: string | null) => setAgentId(value)}
            >
              <SelectTrigger id={`${id}-agent`} className='w-full'>
                <SelectValue
                  placeholder={t('monitoring.ai.settings.chooseAgent')}
                />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected ? (
              <FieldDescription className='flex flex-wrap items-center gap-2'>
                {selected.online ? (
                  <StatusBadge tone='success' size='sm'>
                    <CheckCircle2Icon />
                    {t('monitoring.ai.settings.online')}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone='warning' size='sm'>
                    {t('monitoring.ai.settings.offline')}
                  </StatusBadge>
                )}
                <span>
                  {[selected.tool, selected.model].filter(Boolean).join(' · ')}
                  {selected.busy
                    ? ` · ${t('monitoring.ai.settings.busy', { count: selected.busy })}`
                    : ''}
                </span>
              </FieldDescription>
            ) : null}
            {selected?.goodAt ? (
              <FieldDescription>{selected.goodAt}</FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-language`}>
              {t('monitoring.ai.settings.language')}
            </FieldLabel>
            <Select
              items={languageItems}
              value={language}
              disabled={!canManage}
              onValueChange={(value: string | null) => {
                if (value) setLanguage(value as DiagnosisLanguage | 'default');
              }}
            >
              <SelectTrigger id={`${id}-language`} className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                {languageItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {t('monitoring.ai.settings.languageHint')}
            </FieldDescription>
          </Field>
          <SwitchField
            id={`${id}-enabled`}
            label={t('monitoring.ai.settings.auto')}
            description={t('monitoring.ai.settings.autoHint')}
            checked={enabled}
            onChange={setEnabled}
          />
        </FieldGroup>
      </CardContent>
      {canManage ? (
        <CardFooter className='justify-between gap-2 border-t pt-4'>
          <Button
            variant='ghost'
            nativeButton={false}
            render={<Link to='/runtimes' />}
          >
            {t('monitoring.ai.settings.manageRuntimes')}
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy
              ? t('monitoring.actions.saving')
              : t('monitoring.actions.save')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
