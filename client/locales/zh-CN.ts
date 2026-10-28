import fileUi from '../extensions/nocobase-file-component-ui/locales/zh-CN.js';
import monitoring from './monitoring/zh-CN.js';
import type { AppResource } from './en-US.js';
import systemZhCN from './system/zh-CN.js';

const zhCN: AppResource = {
  // The template's own copy; see `./en-US.ts`.
  ...systemZhCN,
  ...fileUi,
  monitoring,
  // The application's name and its home link, in place of the template's NocoBase.
  app: { ...systemZhCN.app, title: 'NocoMonitor' },
  'navigation.brandHome': 'NocoMonitor 首页',
};

export default zhCN;
