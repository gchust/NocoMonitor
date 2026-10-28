import { useTranslation } from '@nocobase/i18n/client';
import { resolveAssetUrl } from '@nocobase/app-client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

export interface AppBrandProps {
  readonly compact?: boolean;
}

/**
 * NocoMonitor's mark and name, in place of the template's NocoBase logo images. The name is text, so it follows the
 * theme in both color modes without a second image.
 */
export function AppBrand(inputProps: AppBrandProps): ReactElement {
  const { t } = useTranslation();
  const { compact = false } = inputProps;

  return (
    <Link
      aria-label={t('navigation.brandHome')}
      className='flex min-w-0 items-center gap-2 text-foreground'
      to='/'
    >
      <img
        src={resolveAssetUrl('/assets/nocomonitor-mark.svg')}
        alt=''
        className={compact ? 'size-9 shrink-0' : 'size-8 shrink-0'}
      />
      {compact ? null : (
        <span className='truncate text-lg font-semibold tracking-tight'>
          {t('app.title')}
        </span>
      )}
    </Link>
  );
}
