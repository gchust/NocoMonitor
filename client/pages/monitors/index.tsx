import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Skeleton } from '#components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';

import { useApiData } from '../../hooks/use-api-data.js';
import {
  formatLatency,
  formatRelative,
  type List,
  type Monitor,
  type Service,
} from '../../lib/monitoring.js';
import { LoadError, MonitorStatusBadge } from '../monitoring/components.js';
import { useCanManage } from '../monitoring/utils.js';
import { MonitorFormDialog } from './monitor-form.js';

export interface MonitorsOutletContext {
  readonly reload: () => void;
  readonly services: readonly Service[];
}

const STATUS_ORDER = {
  down: 0,
  degraded: 1,
  pending: 2,
  up: 3,
  paused: 4,
} as const;

export default function MonitorsPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const canManage = useCanManage();
  const monitors = useApiData<List<Monitor>>('monitors', undefined, {
    refreshMs: 15000,
  });
  const services = useApiData<List<Service>>('services');
  const [search, setSearch] = useState('');
  const [serviceId, setServiceId] = useState('all');
  const [creating, setCreating] = useState(0);
  const serviceList = useMemo(() => services.data?.data ?? [], [services.data]);
  const serviceName = useMemo(
    () => new Map(serviceList.map((service) => [service.id, service.name])),
    [serviceList],
  );

  const rows = (monitors.data?.data ?? [])
    .filter((monitor) => serviceId === 'all' || monitor.serviceId === serviceId)
    .filter((monitor) => {
      const needle = search.trim().toLowerCase();
      return (
        !needle ||
        `${monitor.name} ${monitor.url} ${monitor.region ?? ''}`
          .toLowerCase()
          .includes(needle)
      );
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const serviceItems = [
    { value: 'all', label: t('monitoring.monitors.allServices') },
    ...serviceList.map((service) => ({
      value: service.id,
      label: service.name,
    })),
  ];

  return (
    <>
      <PageContainer className='mx-auto max-w-7xl'>
        <PageHeader
          title={t('monitoring.monitors.title')}
          description={t('monitoring.monitors.description')}
          actions={
            canManage ? (
              <Button
                onClick={() => setCreating((count) => count + 1)}
                disabled={!serviceList.length}
              >
                <PlusIcon data-icon='inline-start' />
                {t('monitoring.monitors.add')}
              </Button>
            ) : null
          }
        />
        <div className='flex flex-wrap gap-2'>
          <InputGroup className='w-full sm:w-72'>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('monitoring.monitors.search')}
              aria-label={t('monitoring.monitors.search')}
            />
          </InputGroup>
          <Select
            items={serviceItems}
            value={serviceId}
            onValueChange={(value: string | null) =>
              setServiceId(value ?? 'all')
            }
          >
            <SelectTrigger
              className='w-48'
              aria-label={t('monitoring.fields.service')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {serviceItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {monitors.error && !monitors.data ? (
          <LoadError error={monitors.error} onRetry={monitors.reload} />
        ) : null}

        {!monitors.data && monitors.loading ? (
          <Skeleton className='h-96 rounded-xl' />
        ) : monitors.data && !monitors.data.data.length ? (
          <Empty className='border'>
            <EmptyHeader>
              <EmptyTitle>{t('monitoring.monitors.empty')}</EmptyTitle>
              <EmptyDescription>
                {t('monitoring.monitors.emptyHint')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : monitors.data ? (
          <div className='overflow-hidden rounded-xl border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('monitoring.fields.name')}</TableHead>
                  <TableHead>{t('monitoring.fields.status')}</TableHead>
                  <TableHead className='hidden md:table-cell'>
                    {t('monitoring.fields.service')}
                  </TableHead>
                  <TableHead className='hidden lg:table-cell'>
                    {t('monitoring.fields.type')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('monitoring.fields.latency')}
                  </TableHead>
                  <TableHead className='hidden text-right sm:table-cell'>
                    {t('monitoring.fields.lastChecked')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((monitor) => (
                  <TableRow key={monitor.id}>
                    <TableCell className='max-w-80'>
                      <Link
                        to={monitor.id}
                        className='font-medium hover:underline'
                      >
                        {monitor.name}
                      </Link>
                      <div
                        className='truncate text-xs text-muted-foreground'
                        title={monitor.url}
                      >
                        {monitor.url}
                      </div>
                    </TableCell>
                    <TableCell>
                      <MonitorStatusBadge status={monitor.status} />
                    </TableCell>
                    <TableCell className='hidden md:table-cell'>
                      {serviceName.get(monitor.serviceId) ?? '—'}
                      {monitor.region ? (
                        <span className='text-muted-foreground'>
                          {' '}
                          · {monitor.region}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='hidden lg:table-cell'>
                      {t(`monitoring.monitorType.${monitor.type}`)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatLatency(monitor.lastLatencyMs)}
                    </TableCell>
                    <TableCell className='hidden text-right text-muted-foreground sm:table-cell'>
                      {formatRelative(monitor.lastCheckedAt, i18n.language)}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className='h-24 text-center text-muted-foreground'
                    >
                      {t('monitoring.monitors.noMatch')}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </PageContainer>

      {creating ? (
        <MonitorFormDialog
          key={creating}
          services={serviceList}
          open
          onOpenChange={(open) => !open && setCreating(0)}
          onSaved={monitors.reload}
        />
      ) : null}

      <Outlet
        context={
          {
            reload: monitors.reload,
            services: serviceList,
          } satisfies MonitorsOutletContext
        }
      />
    </>
  );
}
