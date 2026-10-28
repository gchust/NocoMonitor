/** The languages a diagnosis, and the incidents NocoMonitor opens, can be written in: the ones the interface offers. */
export const DIAGNOSIS_LANGUAGES = ['en-US', 'zh-CN'] as const;
export type DiagnosisLanguage = (typeof DIAGNOSIS_LANGUAGES)[number];

/** How an agent is told the language: a name it cannot misread. */
export const LANGUAGE_NAMES: Record<DiagnosisLanguage, string> = {
  'en-US': 'English',
  'zh-CN': 'Simplified Chinese (简体中文)',
};

/** The language chosen in AI settings, or the application's default locale when none was. */
export function resolveLanguage(
  chosen: string | null | undefined,
  defaultLocale: string,
): DiagnosisLanguage {
  const wanted = chosen ?? defaultLocale;
  return wanted.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

/** What the probes write into an incident they open, in the operators' language. */
export interface IncidentWording {
  downTitle(monitor: string): string;
  detected(error: string | null, failures: number): string;
  failedAgain(error: string | null): string;
  recovered(successes: number): string;
  answeringAgain(): string;
}

export const ENGLISH_WORDING: IncidentWording = {
  downTitle: (monitor) => `${monitor} is down`,
  detected: (error, failures) =>
    `Automatically detected: ${error ?? 'the check failed'} (${failures} consecutive failures).`,
  failedAgain: (error) =>
    `The monitor failed again: ${error ?? 'the check failed'}.`,
  recovered: (successes) =>
    `The monitor recovered after ${successes} consecutive successful checks.`,
  answeringAgain: () =>
    'The monitor is answering again. The incident stays open until someone resolves it.',
};
