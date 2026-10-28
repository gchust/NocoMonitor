import type { AppServerResource } from './en-US.js';

const zhCN: AppServerResource = {
  monitoring: {
    incident: {
      downTitle: '{{monitor}} 不可用',
      detected: '自动发现：{{error}}（连续 {{count}} 次失败）。',
      checkFailed: '检查失败',
    },
    notify: {
      incidentOpened: {
        title: '事件：{{incident}}',
        body: 'NocoMonitor 为 {{service}} 开启了一个事件。',
      },
      fixAwaitingApproval: {
        title: '批准修复“{{action}}”？',
        body: '{{incident}}：Agent 申请执行“{{action}}”。{{reason}}',
      },
      diagnosisFailed: {
        title: '诊断失败：{{incident}}',
        body: 'Agent 没能完成这个事件的诊断。打开事件重新诊断，或由人接手处理。',
      },
      fixNotRecovered: {
        title: '修复“{{action}}”没有恢复 {{incident}}',
        body: '执行“{{action}}”后服务仍然失败，需要有人接手处理。',
      },
      incidentResolved: {
        title: '已恢复：{{incident}}',
        body: '探测确认 {{service}} 已恢复响应，距事件开启 {{duration}}。',
      },
      minutes: '{{minutes}} 分钟',
      hours: '{{hours}} 小时 {{minutes}} 分钟',
      test: {
        title: 'NocoMonitor 测试通知',
        body: '告警会通过这个渠道送达你。',
      },
      open: '打开事件：{{url}}',
    },
    drill: {
      serviceName: 'NocoMonitor 演练',
      serviceDescription:
        '自动响应流程的演练。结束演练会删除这个服务及其全部记录。',
      monitorName: '演练健康检查',
      actionTitle: '恢复演练目标',
      actionDescription: '让演练的健康检查重新正常响应。',
    },
  },
};

export default zhCN;
