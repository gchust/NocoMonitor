import { useTranslation } from '@nocobase/i18n/client';
import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import type { Check } from '../../lib/monitoring.js';

/** The value of a CSS custom property on the document, which follows the active theme. */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

/** Re-reads the theme's colors when the light or dark class on the document changes. */
function useThemeColors() {
  const read = () => ({
    line: token('--primary', '#3b82f6'),
    down: token('--destructive', '#dc2626'),
    degraded: token('--status-warning', '#d97706'),
    grid: token('--border', '#e5e7eb'),
    text: token('--muted-foreground', '#6b7280'),
    surface: token('--popover', '#ffffff'),
    surfaceText: token('--popover-foreground', '#111827'),
  });
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}

/** Response time over the window, with failed checks marked on the time axis. */
export function LatencyChart({
  checks,
  threshold,
}: {
  readonly checks: readonly Check[];
  readonly threshold: number | null;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();

  const option = useMemo(() => {
    const time = new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const latency = checks.map((check) => [
      check.checkedAt,
      check.status === 'down' ? null : check.latencyMs,
    ]);
    const failures = checks
      .filter((check) => check.status === 'down')
      .map((check) => [check.checkedAt, 0]);
    return {
      animation: false,
      grid: { left: 48, right: 16, top: 16, bottom: 32 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.surface,
        borderColor: colors.grid,
        textStyle: { color: colors.surfaceText, fontSize: 12 },
        valueFormatter: (value: number | null) =>
          value === null || value === undefined ? '—' : `${value} ms`,
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: colors.grid } },
        axisLabel: {
          color: colors.text,
          fontSize: 11,
          hideOverlap: true,
          formatter: (value: number) => time.format(value),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'ms',
        nameTextStyle: { color: colors.text, fontSize: 11 },
        axisLabel: { color: colors.text, fontSize: 11 },
        splitLine: { lineStyle: { color: colors.grid, type: 'dashed' } },
      },
      series: [
        {
          name: t('monitoring.fields.latency'),
          type: 'line',
          data: latency,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 2, color: colors.line },
          itemStyle: { color: colors.line },
          areaStyle: { color: colors.line, opacity: 0.08 },
          markLine: threshold
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: colors.degraded, type: 'dashed' },
                label: {
                  color: colors.degraded,
                  formatter: t('monitoring.monitors.degradedLine'),
                  position: 'insideEndTop',
                },
                data: [{ yAxis: threshold }],
              }
            : undefined,
        },
        {
          name: t('monitoring.monitorStatus.down'),
          type: 'scatter',
          data: failures,
          symbolSize: 8,
          itemStyle: { color: colors.down },
          tooltip: { valueFormatter: () => t('monitoring.monitorStatus.down') },
        },
      ],
    };
  }, [checks, colors, i18n.language, t, threshold]);

  return (
    <ReactECharts
      option={option}
      notMerge
      style={{ height: 260, width: '100%' }}
      opts={{ renderer: 'svg' }}
      aria-label={t('monitoring.monitors.latencyChart')}
    />
  );
}
