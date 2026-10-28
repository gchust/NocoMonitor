import type { LocaleResource } from '@nocobase/i18n';

// The application's own server-side wording: what the probes write into the incidents they open, in the language AI
// settings choose. Use `overrides` to reword a plugin's strings.
const enUS = {
  monitoring: {
    incident: {
      downTitle: '{{monitor}} is down',
      detected:
        'Automatically detected: {{error}} ({{count}} consecutive failures).',
      checkFailed: 'the check failed',
    },
    // Alert notifications, in the language AI settings choose.
    notify: {
      incidentOpened: {
        title: 'Incident: {{incident}}',
        body: 'NocoMonitor opened an incident for {{service}}.',
      },
      fixAwaitingApproval: {
        title: 'Approve fix “{{action}}”?',
        body: '{{incident}} — the agent asks to run “{{action}}”: {{reason}}',
      },
      diagnosisFailed: {
        title: 'Diagnosis failed: {{incident}}',
        body: 'The agent could not diagnose this incident. Open it to try again or take over.',
      },
      fixNotRecovered: {
        title: 'Fix “{{action}}” did not recover {{incident}}',
        body: 'The service is still failing after “{{action}}”. A person needs to take over.',
      },
      incidentResolved: {
        title: 'Recovered: {{incident}}',
        body: 'The probes confirm {{service}} responds again, {{duration}} after the incident opened.',
      },
      minutes: '{{minutes}} min',
      hours: '{{hours}} h {{minutes}} min',
      test: {
        title: 'NocoMonitor test notification',
        body: 'Alerts reach you through this channel.',
      },
      open: 'Open the incident: {{url}}',
    },
    drill: {
      serviceName: 'NocoMonitor drill',
      serviceDescription:
        'A rehearsal of the automatic response. Ending the drill deletes this service and everything it recorded.',
      monitorName: 'Drill health check',
      actionTitle: 'Recover the drill target',
      actionDescription: 'Makes the drill’s health check answer again.',
    },
  },
};

export type AppServerResource = LocaleResource<typeof enUS>;

export default enUS;
