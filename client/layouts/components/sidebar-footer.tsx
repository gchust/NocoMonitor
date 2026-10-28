import { Trans } from 'react-i18next';
import { useClientApplication } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { ActivityIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { SidebarFooter, useSidebar } from '#components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#components/ui/tooltip';

/**
 * The application's sidebar footer: what NocoMonitor is, the NocoBase it is built on, and its version. It replaces the
 * template's NocoBase slogan. In icon mode only the icon remains, and a tooltip carries the same text.
 */
export function AppSidebarFooter(): ReactElement {
  const { t } = useTranslation();
  const { isMobile, state } = useSidebar();
  const iconOnly = state === 'collapsed' && !isMobile;
  // Published by the server from the application's package.json.
  const publicConfig = useClientApplication().config.public;
  const versionLabel = `v${publicConfig.get('app.version', '0.0.0')}`;
  // Defaults keep the footer readable where the application's resources are not loaded.
  const name = t('app.title', { defaultValue: 'NocoMonitor' });
  const tagline = t('monitoring.brand.tagline', {
    defaultValue: 'AI-native monitoring',
  });
  // The tooltip and the icon's accessible name have no link, so the brand's markup is dropped there.
  const builtOn = t('monitoring.brand.builtOn', {
    defaultValue: 'Built on <brand>NocoBase</brand>',
  }).replace(/<\/?brand>/g, '');

  const brandLink = (
    <a
      className='rounded-sm text-sidebar-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring'
      href='https://www.nocobase.com'
      rel='noopener noreferrer'
      target='_blank'
    >
      NocoBase
    </a>
  );

  return (
    <SidebarFooter className='shrink-0 border-t border-sidebar-border'>
      {/* The menu button's inset (`p-2`, `gap-2`), so the icon lines up with the menu icons above. */}
      <div className='flex min-w-0 items-start gap-2 p-2 text-xs leading-5'>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={
                  iconOnly
                    ? `${name} ${versionLabel} ${tagline} ${builtOn}`
                    : undefined
                }
                className='flex h-5 shrink-0 items-center rounded-sm text-sidebar-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring'
                role={iconOnly ? 'img' : undefined}
                tabIndex={iconOnly ? 0 : undefined}
              />
            }
          >
            <ActivityIcon aria-hidden className='size-4' />
          </TooltipTrigger>
          <TooltipContent
            className='max-w-56 flex-col items-start gap-0.5'
            hidden={!iconOnly}
            side='right'
          >
            <span className='font-medium'>
              {name} {versionLabel}
            </span>
            <span>{tagline}</span>
            <span className='mt-1 opacity-70'>{builtOn}</span>
          </TooltipContent>
        </Tooltip>
        <div className='min-w-0 flex-1 group-data-[collapsible=icon]:hidden'>
          <p className='truncate font-medium text-sidebar-foreground'>
            {name}{' '}
            <span className='font-normal text-muted-foreground'>
              {versionLabel}
            </span>
          </p>
          <p className='text-balance text-muted-foreground'>{tagline}</p>
          <p className='text-balance text-muted-foreground'>
            <Trans
              t={t}
              i18nKey='monitoring.brand.builtOn'
              defaults='Built on <brand>NocoBase</brand>'
              components={{ brand: brandLink }}
            >
              Built on {brandLink}
            </Trans>
          </p>
        </div>
      </div>
    </SidebarFooter>
  );
}
