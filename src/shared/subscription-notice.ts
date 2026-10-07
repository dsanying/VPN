/** Suppliers sometimes encode account notices as fake proxy entries. They must not enter latency statistics. */
export function isSubscriptionNotice(name: string | undefined): boolean {
  if (!name) return false;
  const text = name.trim();
  return (
    /^(?:剩余流量|剩餘流量|套餐到期|订阅到期|訂閱到期|到期时间|到期時間)\s*[:：]/.test(text) ||
    /^过滤掉\s*\d+\s*条线路$/.test(text) ||
    /^[↓]+必看[↓]+$/.test(text)
  );
}
