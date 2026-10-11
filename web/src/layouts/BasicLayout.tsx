import {
  GlobalOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons';
import { Drawer, Grid, Layout, type MenuProps } from 'antd';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';
import { IconButton, LoadingState, RouteCrumbsContext, SidebarMenu } from '@/components/client';
import { menuRoutes, type MenuEntry } from '@/routes';
import { matchMenuChain, selectedMenuKey } from '@/routes/menuMatch';
import { useThemeStore } from '@/stores/useThemeStore';
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
        {Array.from(t('common.brand'))[0]}
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
  return (
    <div className="ds-basic-layout__sider-footer">
      <SidebarMenu
        mode="inline"
        inlineCollapsed={compact}
        selectable={false}
        items={[
          ...items,
          {
            key: 'theme',
            icon: mode === 'dark' ? <SunOutlined aria-hidden /> : <MoonOutlined aria-hidden />,
            label: <span aria-label={t('common.theme.toggle')}>{t('common.theme.toggle')}</span>,
            onClick: toggle,
          },
          {
            key: 'language',
            icon: <GlobalOutlined aria-hidden />,
            label: (
              <span lang={language} aria-label={t('common.language.switch')}>
                {language === 'zh-CN' ? '中文' : 'EN'}
              </span>
            ),
            onClick: () => void i18n.changeLanguage(language),
          },
        ]}
      />
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
              styles={{ body: { padding: '8px 0' }, footer: { padding: 0 } }}
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
