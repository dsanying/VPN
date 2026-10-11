type Translator = (key: string) => string;
export const updateKindLabels = (t: Translator) => ({
  software: t('common.vocab.software'), core: t('common.vocab.core'),
  data: t('vpn.updateKind_data'), subscriptions: t('common.vocab.subscription'),
});
export const updateStatusLabels = (t: Translator) => ({
  latest: t('vpn.updateStatus_latest'), applied: t('common.vocab.applied'),
  ready: t('common.vocab.readyToApply'), error: t('common.vocab.checkFailed'),
  unsupported: t('vpn.updateStatus_unsupported'), incompatible: t('vpn.updateStatus_incompatible'),
});
