import type { ReactElement } from 'react';
import { cn } from 'cn';

/**
 * Decorative brand geometry; kept outside page content and hidden from assistive technology. NocoMonitor's pulse line
 * (the line of `public/assets/nocomonitor-mark.svg`) in place of the template's NocoBase mark.
 */
export function BrandWatermark({
  className,
}: {
  readonly className?: string;
}): ReactElement {
  return (
    <svg
      aria-hidden='true'
      focusable='false'
      viewBox='0 0 64 64'
      className={cn(
        'pointer-events-none absolute top-0 right-4 w-48 text-primary opacity-[0.06] sm:right-8 sm:w-64',
        className,
      )}
      fill='none'
      stroke='currentColor'
      strokeWidth='3'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M6 34h13l5-12 8 22 6-16 3 6h17' />
    </svg>
  );
}
