import type { ReactNode } from 'react';
import { translateLogMessage } from '@shared/log-presentation';
import i18n from '@/i18n';
import { notification } from './antdStatic';

const actionKeys = {
  openSettings: 'vpn.openSettings',
  openWebsite: 'vpn.openWebsite',
  create: 'common.actions.create',
  update: 'common.actions.update',
  save: 'common.actions.save',
  delete: 'common.actions.delete',
  reset: 'common.actions.reset',
  enable: 'common.actions.enable',
  disable: 'common.actions.disable',
  sync: 'common.actions.sync',
  export: 'common.actions.export',
  upload: 'common.actions.upload',
  publish: 'common.actions.publish',
  unpublish: 'common.actions.unpublish',
  clear: 'common.actions.clear',
  clone: 'common.actions.clone',
  copy: 'common.actions.copy',
  send: 'common.actions.send',
  logout: 'common.actions.logout',
  connect: 'common.vocab.connect',
  disconnect: 'common.vocab.disconnect',
  use: 'common.vocab.use',
  testLatency: 'common.vocab.testLatency',
  close: 'common.actions.close',
  import: 'vpn.importNodes',
  install: 'common.vocab.install',
  uninstall: 'vpn.uninstall',
  rollback: 'common.vocab.rollback',
  apply: 'common.vocab.apply',
  login: 'common.vocab.signIn',
  cancel: 'common.actions.cancel',
  checkUpdate: 'vpn.checkUpdate',
  checkConnectivity: 'vpn.services',
  unlock: 'common.vocab.unlock',
} as const;
export type WriteAction = keyof typeof actionKeys;
export const WRITE_ACTIONS = Object.keys(actionKeys) as WriteAction[];
type ResultTone = 'success' | 'error' | 'warning';
function result(tone: ResultTone, title: string, description?: string) {
  notification.open({
    type: tone,
    key: JSON.stringify(['operation', tone, title, description ?? '']),
    title, description, placement: 'topRight',
    duration: tone === 'error' ? 8 : tone === 'warning' ? 6 : 3,
  });
}
export function failureReason(reason: unknown): string | undefined {
  const text = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
  return text.trim() ? translateLogMessage(text.trim(), i18n.language) : undefined;
}
export function notifyActionSuccess(action: WriteAction, description?: string) {
  result('success', i18n.t('common.feedback.actionSucceeded', { action: i18n.t(actionKeys[action]) }), description);
}
export function notifyActionFailed(action: WriteAction, reason?: unknown) {
  result('error', i18n.t('common.feedback.actionFailed', { action: i18n.t(actionKeys[action]) }), failureReason(reason));
}
export function notifyWarning(title: string, description?: string) {
  result('warning', title, description);
}
export function showPendingUpdates(title: string, actions: ReactNode, onClose: () => void) {
  notification.open({ key: 'global-pending-updates', title, actions, onClose, duration: 0, placement: 'topRight' });
}
export function closePendingUpdates() {
  notification.destroy('global-pending-updates');
}
