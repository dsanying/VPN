import {
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SunOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Grid, Layout, type MenuProps, Tooltip } from 'antd';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';
import { IconButton, LoadingState, RouteCrumbsContext, SidebarMenu } from '@/components/client';
import { menuRoutes, type MenuEntry } from '@/routes';
import { matchMenuChain, selectedMenuKey } from '@/routes/menuMatch';
import { useThemeStore } from '@/store/useThemeStore';
import { useUpdateStore } from '@/store/update-store';
import { api } from '@/ipc';
import { clientHost } from '@/config/client-host';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import brandIcon from '@/assets/brand-icon.svg';
import './BasicLayout.css';

const collapsedKey = 'shadowvpn-sider-collapsed';
function rememberedCollapse() {
  try {
    return localStorage.getItem(collapsedKey) === 'true';
  } catch {
    return false;
  }
}
function navigation(
  entries: MenuEntry[],
  translate: Parameters<MenuEntry['label']>[0]
): MenuProps['items'] {
  return entries
    .filter((entry) => !entry.hideInMenu)
    .map((entry) => {
      const children = navigation(entry.children ?? [], translate);
      return {
        key: entry.path,
        icon: entry.icon,
        label: children?.length ? (
          entry.label(translate)
        ) : (
          <Link to={entry.path}>{entry.label(translate)}</Link>
        ),
        ...(children?.length ? { children } : {}),
      };
    });
}
function Brand() {
  const { t } = useTranslation();
  return (
    <Link className="ds-brand-header" to="/">
      <span className="ds-brand-header__icon" aria-hidden>
        <img src={brandIcon} alt="" width={24} height={24} />
      </span>
      <span className="ds-brand-header__title">{t('common.brand')}</span>
    </Link>
  );
}
function Preferences({ compact, items = [] }: { compact?: boolean; items?: MenuProps['items'] }) {
  const { t, i18n } = useTranslation();
  const mode = useThemeStore((state) => state.mode);
  const toggle = useThemeStore((state) => state.toggle);
  const language = i18n.language === 'en-US' ? 'zh-CN' : 'en-US';
  // 已下载待生效的更新常驻侧边栏左下角（对齐常见客户端的「重启以更新」角标）；点击即应用。
  // GlobalUpdateNotice 的小窗仍会自动弹出一次，关闭后这里是不打扰的常驻入口。
  // selector 必须返回稳定引用：zustand v5 走 useSyncExternalStore，这里若 .filter() 会在
  // 每次 getSnapshot 产生新数组 → 「getSnapshot should be cached」无限重渲染（整页抽搐级）。
  const updateItems = useUpdateStore((state) => state.snapshot.items);
  const ready = updateItems.filter((item) => item.status === 'ready');
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="ds-basic-layout__sider-footer">
      {items?.length ? (
        <SidebarMenu mode="inline" inlineCollapsed={compact} selectable={false} items={items} />
      ) : null}
      {ready.map((item) => {
        const restartLabel = t(
          clientHost().bundledCore
            ? 'vpn.installSoftwareUpdate'
            : item.restart === 'software'
              ? 'vpn.restartSoftwareUpdate'
              : 'vpn.restartProxyUpdate'
        );
        return (
          <Tooltip key={item.kind} title={compact ? restartLabel : undefined}>
            <Button
              type="primary"
              ghost
              block
              size="small"
              className="ds-basic-layout__sider-update"
              aria-label={restartLabel}
              icon={<SyncOutlined aria-hidden />}
              loading={busy === item.kind}
              disabled={busy !== null && busy !== item.kind}
              onClick={() => {
                setBusy(item.kind);
                void api.update
                  .apply(item.kind)
                  .then((result) => {
                    if (!result.success) throw new Error(result.error);
                    // Native Android installation is completed by the system, after its visible confirmation.
                    if (!result.installationRequested && !result.permissionRequired)
                      notifyActionSuccess('update');
                  })
                  .catch((error) => notifyActionFailed('update', error))
                  .finally(() => setBusy(null));
              }}
            >
              {compact ? null : (
                <span>
                  {t('vpn.siderRestartUpdate')}
                  {item.version ? ` · ${item.version}` : ''}
                </span>
              )}
            </Button>
          </Tooltip>
        );
      })}
      <div className="ds-basic-layout__sider-prefs">
        <IconButton
          type="text"
          label={t('common.theme.toggle')}
          icon={mode === 'dark' ? <SunOutlined aria-hidden /> : <MoonOutlined aria-hidden />}
          onClick={toggle}
        />
        <IconButton
          type="text"
          label={t('common.language.switch')}
          onClick={() => void i18n.changeLanguage(language)}
        >
          <span lang={language}>{language === 'zh-CN' ? 'EN' : '中文'}</span>
        </IconButton>
      </div>
    </div>
  );
}
export default function BasicLayout({
  children,
  menuEntries = menuRoutes,
  footerItems,
}: {
  children?: ReactNode;
  menuEntries?: MenuEntry[];
  footerItems?: MenuProps['items'];
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const mobile = Grid.useBreakpoint().md === false;
  const [collapsed, setCollapsed] = useState(rememberedCollapse);
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const open = drawerPath === pathname;
  const content = useRef<HTMLElement>(null);
  const chain = useMemo(() => matchMenuChain(menuEntries, pathname), [menuEntries, pathname]);
  const selected = selectedMenuKey(chain);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [pathname]);
  const collapse = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(collapsedKey, String(next));
    } catch {
      /* Session preference still applies. */
    }
  };
  const menu = (
    <SidebarMenu
      mode="inline"
      inlineCollapsed={!mobile && collapsed}
      items={navigation(menuEntries, t)}
      selectedKeys={selected ? [selected] : []}
    />
  );
  const crumbs = chain.map((entry) => ({ path: entry.path, title: entry.label(t) }));
  return (
    <RouteCrumbsContext.Provider value={crumbs}>
      <Layout className="ds-basic-layout" hasSider={!mobile}>
        {mobile ? (
          <>
            <Layout.Header className="ds-basic-layout__topbar">
              <IconButton
                type="text"
                label={t('common.vocab.menu')}
                icon={<MenuOutlined aria-hidden />}
                onClick={() => setDrawerPath(pathname)}
              />
              <Brand />
            </Layout.Header>
            <Drawer
              open={open}
              onClose={() => setDrawerPath(null)}
              placement="left"
              size={240}
              title={<Brand />}
              styles={{ body: { padding: 'var(--ds-space-8) 0' }, footer: { padding: 0 } }}
              footer={<Preferences items={footerItems} />}
            >
              {menu}
            </Drawer>
          </>
        ) : (
          <Layout.Sider
            className="ds-basic-layout__sider"
            width={240}
            collapsedWidth={80}
            collapsed={collapsed}
            trigger={null}
            theme="light"
          >
            <div className="ds-basic-layout__sider-inner">
              <header
                className="ds-basic-layout__sider-header"
                data-collapsed={collapsed || undefined}
              >
                {collapsed ? (
                  <IconButton
                    type="text"
                    label={t('common.vocab.expandSidebar')}
                    icon={<MenuUnfoldOutlined aria-hidden />}
                    onClick={() => collapse(false)}
                  />
                ) : (
                  <>
                    <Brand />
                    <IconButton
                      type="text"
                      label={t('common.vocab.collapseSidebar')}
                      icon={<MenuFoldOutlined aria-hidden />}
                      onClick={() => collapse(true)}
                    />
                  </>
                )}
              </header>
              <nav className="ds-basic-layout__nav" aria-label={t('common.vocab.menu')}>
                {menu}
              </nav>
              <Preferences compact={collapsed} items={footerItems} />
            </div>
          </Layout.Sider>
        )}
        <Layout className="ds-basic-layout__main">
          <Layout.Content
            ref={content}
            className="ds-basic-layout__content"
            role="main"
            tabIndex={0}
          >
            <Suspense fallback={<LoadingState label={t('common.loadingPage')} />}>
              {children ?? <Outlet />}
            </Suspense>
          </Layout.Content>
        </Layout>
      </Layout>
    </RouteCrumbsContext.Provider>
  );
}
