import { expect, type Page } from '@playwright/test';

/** User action results belong to one top-right notification, never an inline banner. */
export async function expectOperationNotification(page: Page, title: string, description?: string) {
  const notice = page.locator('.ant-notification-topRight .ant-notification-notice').filter({ has: page.getByText(title, { exact: true }) });
  await expect(notice).toHaveCount(1);
  await expect(notice).toBeVisible();
  // Wait for Ant's entry motion to finish before measuring the final placement.
  await expect.poll(async () => {
    const box = await notice.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) return false;
    const right = viewport.width - box.x - box.width;
    return box.y >= 0 && box.y <= 40 && right >= 0 && right <= 40;
  }).toBe(true);
  await expect(page.locator('.ant-alert').filter({ hasText: title })).toHaveCount(0);
  if (description) {
    await expect(notice.getByText(description, { exact: true })).toBeVisible();
    await expect(page.locator('.ant-alert').filter({ hasText: description })).toHaveCount(0);
  }
  return notice;
}
