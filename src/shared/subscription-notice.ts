/** Suppliers sometimes encode account notices as fake proxy entries. They must not enter latency statistics. */
export function isSubscriptionNotice(name: string | undefined): boolean {
  if (!name) return false;
  const text = name.trim();
  return (
    /^(?:剩余流量|剩餘流量|已用流量|已使用流量|总流量|總流量|流量总额|账户余额|帳戶餘額|余额|餘額|remaining traffic|traffic remaining|used traffic|total traffic|balance|expires?|expiry|套餐到期|订阅到期|訂閱到期|到期时间|到期時間)\s*[:：]/i.test(
      text
    ) ||
    /^过滤掉\s*\d+\s*条线路$/.test(text) ||
    /^[↓]+必看[↓]+$/.test(text)
  );
}
