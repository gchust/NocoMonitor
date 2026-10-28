import { resolveAssetUrl } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon, RadarIcon, ShieldCheck } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Trans } from 'react-i18next';

import { AuthSplitLayout } from '#extensions/nocobase-auth-split-layout/auth-split-layout';

import './auth-page.css';

export interface AuthPageProps {
  readonly className?: string;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly children: ReactNode;
}

/**
 * The frame every sign-in, sign-up and password page shares: the form on the left, and on wide screens NocoMonitor's
 * brand panel on the right, in place of the template's NocoBase one.
 */
export function AuthPage({
  children,
  className,
  description,
  title,
}: AuthPageProps): ReactElement {
  const { t } = useTranslation();
  return (
    <AuthSplitLayout
      aside={<BrandPanel />}
      asideLabel={t('auth.about')}
      className={['auth-page', className].filter(Boolean).join(' ')}
      description={description}
      logo={
        <img alt='' src={resolveAssetUrl('/assets/nocomonitor-mark.svg')} />
      }
      name={t('app.title')}
      title={title}
    >
      {children}
    </AuthSplitLayout>
  );
}

// The brand panel stays dark in both color modes; its dedicated palette belongs to the theme presets.
function BrandPanel(): ReactElement {
  const { t } = useTranslation();
  const features = [
    {
      description: t('monitoring.brand.probesDescription'),
      icon: RadarIcon,
      id: 'probes',
      title: t('monitoring.brand.probes'),
    },
    {
      description: t('monitoring.brand.diagnosisDescription'),
      icon: BotIcon,
      id: 'diagnosis',
      title: t('monitoring.brand.diagnosis'),
    },
    {
      description: t('monitoring.brand.guardrailsDescription'),
      icon: ShieldCheck,
      id: 'guardrails',
      title: t('monitoring.brand.guardrails'),
    },
  ];

  return (
    <div className='auth-brand-panel relative grid h-full place-items-center overflow-hidden p-12 text-white'>
      <div className='relative w-full max-w-md'>
        <p className='text-xs font-semibold tracking-[0.16em] text-(--auth-brand-highlight) uppercase'>
          {t('monitoring.brand.eyebrow')}
        </p>
        <h2 className='mt-6 text-4xl leading-tight font-semibold tracking-tight'>
          {t('monitoring.brand.titleFirst')}
          <br />
          {t('monitoring.brand.titleSecond')}
          <br />
          {t('monitoring.brand.titleThird')}
        </h2>
        <p className='mt-6 text-sm leading-7 text-(--auth-brand-muted)'>
          {t('monitoring.brand.description')}
        </p>
        <div className='mt-12 space-y-8'>
          {features.map(({ description, icon: Icon, id, title }) => (
            <div className='flex gap-4' key={id}>
              <span className='grid size-10 shrink-0 place-items-center rounded-xl bg-(--auth-brand-highlight)/8 text-(--auth-brand-highlight)'>
                <Icon aria-hidden='true' className='size-5' />
              </span>
              <div>
                <p className='text-sm font-medium'>{title}</p>
                <p className='mt-1.5 text-sm leading-6 text-(--auth-brand-muted)'>
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className='mt-12 border-t border-white/8 pt-6 text-xs text-(--auth-brand-muted)'>
          <Trans
            t={t}
            i18nKey='monitoring.brand.builtOn'
            components={{
              brand: (
                <a
                  className='text-white/80 hover:underline'
                  href='https://www.nocobase.com'
                  rel='noopener noreferrer'
                  target='_blank'
                />
              ),
            }}
          />
        </p>
      </div>
    </div>
  );
}
