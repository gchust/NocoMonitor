import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router';

import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { RouteChildPage } from '#components/route-child-page';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#components/ui/alert-dialog';
import { Button } from '#components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Skeleton } from '#components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';

import { useApiData } from '../../hooks/use-api-data.js';
import {
  formatDateTime,
  formatDuration,
  formatLatency,
  formatRelative,
  formatUptime,
  type Check,
  type Incident,
  type List,
  type Monitor,
  type Service,
  type UptimeDay,
} from '../../lib/monitoring.js';
import {
  Fact,
  IncidentStatusBadge,
  LoadError,
  MonitorStatusBadge,
  StatusDot,
  UptimeBars,
} from '../monitoring/components.js';
import { errorText, useCanManage } from '../monitoring/utils.js';
import type { MonitorsOutletContext } from './index.js';
import { LatencyChart } from './latency-chart.js';
import { MonitorFormDialog } from './monitor-form.js';

interface MonitorDetail {
  monitor: Monitor;
  service: Service | null;
  days: UptimeDay[];
  uptime: number | null;
  incidents: Incident[];
}

const WINDOWS = [1, 24, 24 * 7] as const;

export default function MonitorDetailPage(): ReactElement {
  const { monitorId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const parent = useOutletContext<MonitorsOutletContext>();
  const canManage = useCanManage();
  const [hours, setHours] = useState<number>(24);
  const [searchParams] = useSearchParams();
  const [editing, setEditing] = useState(0);
  // `?edit` opens the editor once the monitor and the viewer's permissions are known: an incident the agent called a
  // false alarm leads here to change the monitor.
  const [editRequested, setEditRequested] = useState(() =>
    searchParams.has('edit'),
  );
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string>();
  const path = `monitors/${encodeURIComponent(monitorId)}`;
  const detail = useApiData<{ data: MonitorDetail }>(path, undefined, {
    refreshMs: 15000,
  });
  const checks = useApiData<List<Check>>(
    `${path}/checks`,
    { hours },
    { refreshMs: 30000 },
  );
  const data = detail.data?.data;
  const monitor = data?.monitor;
  const checkList = checks.data?.data ?? [];
  if (editRequested && monitor && canManage) {
    setEditRequested(false);
    setEditing((count) => count + 1);
  }

  const reload = (): void => {
    detail.reload();
    checks.reload();
    parent.reload();
  };

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    success: string,
  ): Promise<void> => {
    setBusy(key);
    try {
      await action();
      toaster.show({ type: 'success', title: success });
      reload();
    } catch (error) {
      toaster.show({
        type: 'error',
        title: errorText(error, t('monitoring.errors.save')),
      });
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await api.request({ path, method: 'DELETE' });
      toaster.show({
        type: 'success',
        title: t('monitoring.monitors.deleted'),
      });
      parent.reload();
      void navigate('..', { replace: true });
    } catch (error) {
      toaster.show({
        type: 'error',
        title: errorText(error, t('monitoring.errors.save')),
      });
    }
  };

  const recent = [...checkList].reverse();
  const windowStats = summarize(checkList);

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
        {monitor ? (
          <>
            <header className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
              <div className='min-w-0 space-y-2'>
                <div className='flex flex-wrap items-center gap-3'>
                  <h1 className='font-heading text-2xl font-semibold tracking-[-0.035em]'>
                    {monitor.name}
                  </h1>
                  <MonitorStatusBadge status={monitor.status} />
                </div>
                <p className='truncate text-sm text-muted-foreground'>
                  <span className='font-mono'>{monitor.method}</span>{' '}
                  {monitor.url}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {data.service?.name}
                  {monitor.region ? ` · ${monitor.region}` : ''}
                  {' · '}
                  {t('monitoring.monitors.every', {
                    seconds: monitor.intervalSec,
                  })}
                  {monitor.statusChangedAt
                    ? ` · ${t('monitoring.monitors.statusSince', { when: formatRelative(monitor.statusChangedAt, i18n.language) })}`
                    : ''}
                </p>
              </div>
              {canManage ? (
                <div className='flex flex-wrap gap-2'>
                  <Button
                    variant='outline'
                    disabled={busy !== undefined || !monitor.enabled}
                    onClick={() =>
                      void run(
                        'check',
                        () =>
                          api.request({
                            path: `${path}/check`,
                            method: 'POST',
                          }),
                        t('monitoring.monitors.checked'),
                      )
                    }
                  >
                    <RefreshCwIcon
                      data-icon='inline-start'
                      className={busy === 'check' ? 'animate-spin' : undefined}
                    />
                    {t('monitoring.monitors.checkNow')}
                  </Button>
                  <Button
                    variant='outline'
                    disabled={busy !== undefined}
                    onClick={() =>
                      void run(
                        'toggle',
                        () =>
                          api.request({
                            path,
                            method: 'PATCH',
                            json: { enabled: !monitor.enabled },
                          }),
                        monitor.enabled
                          ? t('monitoring.monitors.paused')
                          : t('monitoring.monitors.resumed'),
                      )
                    }
                  >
                    {monitor.enabled ? (
                      <PauseIcon data-icon='inline-start' />
                    ) : (
                      <PlayIcon data-icon='inline-start' />
                    )}
                    {monitor.enabled
                      ? t('monitoring.monitors.pause')
                      : t('monitoring.monitors.resume')}
                  </Button>
                  <Button
                    variant='outline'
                    onClick={() => setEditing((count) => count + 1)}
                  >
                    <PencilIcon data-icon='inline-start' />
                    {t('monitoring.actions.edit')}
                  </Button>
                  <Button
                    variant='destructive'
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2Icon data-icon='inline-start' />
                    {t('monitoring.actions.delete')}
                  </Button>
                </div>
              ) : null}
            </header>

            {monitor.lastError && monitor.status !== 'up' ? (
              <div className='rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive'>
                <span className='font-medium'>
                  {t('monitoring.monitors.lastError')}:{' '}
                </span>
                {monitor.lastError}
              </div>
            ) : null}

            <dl className='grid grid-cols-2 gap-4 rounded-xl border p-4 md:grid-cols-4'>
              <Fact label={t('monitoring.monitors.uptime90')}>
                {formatUptime(data.uptime, i18n.language)}
              </Fact>
              <Fact
                label={t('monitoring.monitors.uptimeWindow', { count: hours })}
              >
                {formatUptime(windowStats.uptime, i18n.language)}
              </Fact>
              <Fact label={t('monitoring.monitors.avgLatency')}>
                {formatLatency(windowStats.avg)}
              </Fact>
              <Fact label={t('monitoring.monitors.p95Latency')}>
                {formatLatency(windowStats.p95)}
              </Fact>
            </dl>

            <Card>
              <CardHeader>
                <CardTitle>{t('monitoring.monitors.responseTime')}</CardTitle>
                <CardAction>
                  <Tabs
                    value={hours}
                    onValueChange={(value) => setHours(Number(value))}
                  >
                    <TabsList>
                      {WINDOWS.map((value) => (
                        <TabsTrigger key={value} value={value}>
                          {value < 24
                            ? `${value}h`
                            : value === 24
                              ? '24h'
                              : '7d'}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </CardAction>
              </CardHeader>
              <CardContent>
                {checks.loading && !checks.data ? (
                  <Skeleton className='h-64' />
                ) : checkList.length ? (
                  <LatencyChart
                    checks={checkList}
                    threshold={monitor.degradedLatencyMs}
                  />
                ) : (
                  <p className='py-16 text-center text-sm text-muted-foreground'>
                    {t('monitoring.monitors.noChecks')}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('monitoring.monitors.uptimeHistory')}</CardTitle>
              </CardHeader>
              <CardContent className='space-y-2'>
                <UptimeBars days={data.days} />
                <div className='flex justify-between text-xs text-muted-foreground'>
                  <span>
                    {t('monitoring.uptime.daysAgo', {
                      count: data.days.length,
                    })}
                  </span>
                  <span>{t('monitoring.uptime.today')}</span>
                </div>
              </CardContent>
            </Card>

            <div className='grid gap-6 lg:grid-cols-2'>
              <Card>
                <CardHeader>
                  <CardTitle>{t('monitoring.monitors.recentChecks')}</CardTitle>
                </CardHeader>
                <CardContent className='px-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='pl-4'>
                          {t('monitoring.fields.time')}
                        </TableHead>
                        <TableHead>{t('monitoring.fields.status')}</TableHead>
                        <TableHead className='text-right'>HTTP</TableHead>
                        <TableHead className='pr-4 text-right'>
                          {t('monitoring.fields.latency')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.slice(0, 15).map((check) => (
                        <TableRow key={check.id}>
                          <TableCell className='pl-4 text-muted-foreground'>
                            {formatDateTime(check.checkedAt, i18n.language)}
                          </TableCell>
                          <TableCell>
                            <span className='flex items-center gap-2'>
                              <StatusDot status={check.status} />
                              <span
                                className='max-w-56 truncate'
                                title={check.error ?? undefined}
                              >
                                {check.error ??
                                  t(`monitoring.monitorStatus.${check.status}`)}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {check.httpStatus ?? '—'}
                          </TableCell>
                          <TableCell className='pr-4 text-right tabular-nums'>
                            {formatLatency(check.latencyMs)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('monitoring.monitors.incidents')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.incidents.length ? (
                    <ul className='divide-y'>
                      {data.incidents.map((incident) => (
                        <li key={incident.id} className='py-3 first:pt-0'>
                          <Link
                            to={`/incidents/${incident.id}`}
                            className='flex flex-wrap items-center gap-2 hover:underline'
                          >
                            <IncidentStatusBadge status={incident.status} />
                            <span className='font-medium'>
                              {incident.title}
                            </span>
                          </Link>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            {formatDateTime(incident.startedAt, i18n.language)}{' '}
                            ·{' '}
                            {formatDuration(
                              incident.startedAt,
                              incident.resolvedAt,
                              i18n.language,
                            )}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className='text-sm text-muted-foreground'>
                      {t('monitoring.monitors.noIncidents')}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <dl className='grid grid-cols-2 gap-4 rounded-xl border p-4 md:grid-cols-4'>
              <Fact label={t('monitoring.fields.type')}>
                {t(`monitoring.monitorType.${monitor.type}`)}
              </Fact>
              <Fact label={t('monitoring.fields.expectedStatus')}>
                {monitor.expectedStatus}
              </Fact>
              <Fact label={t('monitoring.monitors.assertion')}>
                {monitor.type === 'keyword'
                  ? monitor.keyword
                  : monitor.type === 'json'
                    ? `${monitor.jsonPath} = ${monitor.jsonExpected}`
                    : '—'}
              </Fact>
              <Fact label={t('monitoring.fields.timeoutMs')}>
                {formatLatency(monitor.timeoutMs)}
              </Fact>
              <Fact label={t('monitoring.monitors.thresholds')}>
                {t('monitoring.monitors.thresholdsValue', {
                  failures: monitor.failureThreshold,
                  successes: monitor.recoveryThreshold,
                })}
              </Fact>
              <Fact label={t('monitoring.fields.degradedLatencyMs')}>
                {formatLatency(monitor.degradedLatencyMs)}
              </Fact>
              <Fact label={t('monitoring.fields.autoDiagnose')}>
                {monitor.autoDiagnose
                  ? t('monitoring.common.on')
                  : t('monitoring.common.off')}
              </Fact>
              <Fact label={t('monitoring.fields.remediationLevel')}>
                {t(`monitoring.remediation.${monitor.remediationLevel}`)}
              </Fact>
            </dl>
          </>
        ) : null}
      </PageContainer>

      {editing && monitor ? (
        <MonitorFormDialog
          key={editing}
          monitor={monitor}
          services={parent.services}
          open
          onOpenChange={(open) => !open && setEditing(0)}
          onSaved={reload}
        />
      ) : null}

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('monitoring.monitors.deleteTitle', { name: monitor?.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('monitoring.monitors.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('monitoring.actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void remove()}
            >
              {t('monitoring.actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RouteChildPage>
  );
}

function summarize(checks: readonly Check[]): {
  uptime: number | null;
  avg: number | null;
  p95: number | null;
} {
  if (!checks.length) return { uptime: null, avg: null, p95: null };
  const up = checks.filter((check) => check.status !== 'down').length;
  const latencies = checks
    .filter((check) => check.status !== 'down' && check.latencyMs !== null)
    .map((check) => check.latencyMs!)
    .sort((a, b) => a - b);
  return {
    uptime: up / checks.length,
    avg: latencies.length
      ? Math.round(
          latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
        )
      : null,
    p95: latencies.length
      ? latencies[
          Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
        ]
      : null,
  };
}
