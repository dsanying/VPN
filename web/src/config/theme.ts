import { theme, type ThemeConfig } from 'antd';
import { designTokens as d, readCssColorToken, type ThemeMode } from '@/design/tokens';

const color = (role: string) => readCssColorToken(`--ds-color-${role}`);

/** The client's public Ant Design tokens are derived from its saved visual contract. */
export function buildThemeConfig(mode: ThemeMode): ThemeConfig {
  const foreground = color('text');
  const muted = color('text-tertiary');
  const disabled = color('text-disabled');
  const surface = color('surface');
  const hover = color('surface-subtle');
  const fill = color('surface-muted');
  const raised = color('surface-elevated');
  const border = color('border');
  const strong = color('border-strong');
  const primary = color('primary');
  const selected = color('primary-surface');
  const inverse = color('primary-foreground');
  const primaryHover = color('primary-hover');
  const focusShadow = readCssColorToken('--ds-shadow-focus');
  const semantic = {
    colorPrimary: primary,
    colorPrimaryHover: primaryHover,
    colorPrimaryActive: color('primary-active'),
    colorPrimaryText: primary,
    colorPrimaryTextHover: primaryHover,
    colorPrimaryTextActive: color('primary-active'),
    colorPrimaryBg: selected,
    colorPrimaryBgHover: selected,
    colorPrimaryBorder: color('primary-border'),
    colorPrimaryBorderHover: primary,
    colorLink: color('link'),
    colorLinkHover: color('link-hover'),
    colorLinkActive: color('link-hover'),
    colorSuccess: color('success'),
    colorSuccessBg: color('success-surface'),
    colorSuccessBgHover: color('success-surface'),
    colorSuccessBorder: color('success-border'),
    colorWarning: color('warning'),
    colorWarningBg: color('warning-surface'),
    colorWarningBgHover: color('warning-surface'),
    colorWarningBorder: color('warning-border'),
    colorError: color('error'),
    colorErrorHover: color('error'),
    colorErrorActive: color('error'),
    colorErrorText: color('error'),
    colorErrorTextHover: color('error'),
    colorErrorTextActive: color('error'),
    colorErrorBg: color('error-surface'),
    colorErrorBgHover: color('error-surface'),
    colorErrorBorder: color('error-border'),
    colorInfo: color('info'),
    colorInfoBg: color('info-surface'),
    colorInfoBorder: color('info-border'),
    colorShadow: color('shadow'),
    colorText: foreground,
    colorTextHeading: foreground,
    colorTextSecondary: color('text-secondary'),
    colorTextTertiary: muted,
    colorTextQuaternary: disabled,
    colorTextDisabled: disabled,
    colorTextLightSolid: inverse,
    colorBgBase: surface,
    colorBgLayout: color('canvas'),
    colorBgContainer: surface,
    colorBgElevated: raised,
    colorBgSpotlight: raised,
    colorBgContainerDisabled: fill,
    colorBorder: strong,
    colorBorderSecondary: border,
    colorFill: fill,
    colorFillSecondary: fill,
    colorFillTertiary: fill,
    colorFillQuaternary: hover,
    colorBgTextHover: fill,
    colorBgTextActive: fill,
    controlItemBgHover: fill,
    controlItemBgActive: selected,
    controlItemBgActiveHover: selected,
    controlItemBgActiveDisabled: fill,
  };
  // Ant Design's named button colors use preset palette slots independently of status tokens.
  const actionPalette = Object.fromEntries(
    [
      ['green', 'success'],
      ['orange', 'warning'],
    ].flatMap(([preset, role]) => {
      const value = color(role);
      const background = color(`${role}-surface`);
      const outline = color(`${role}-border`);
      return [
        [`${preset}1`, background],
        [`${preset}2`, background],
        [`${preset}3`, outline],
        [`${preset}6`, value],
        [`${preset}Hover`, value],
        [`${preset}Active`, value],
      ];
    })
  );
  const geometry = {
    borderRadius: d.radius.md,
    borderRadiusLG: d.radius.lg,
    borderRadiusSM: d.radius.xs,
    borderRadiusXS: d.radius.xs,
    controlHeight: d.control.height,
    controlHeightLG: d.control.heightLg,
    controlHeightSM: d.control.heightSm,
    fontFamily: d.font.family,
    fontFamilyCode: d.font.mono,
    fontSize: d.font.sizeBody,
    fontSizeSM: d.font.sizeXs,
    fontSizeLG: d.font.sizeLg,
    fontSizeXL: d.font.sizeTitle,
    fontSizeHeading1: d.font.sizePageTitle,
    fontSizeHeading2: d.font.sizeTitle,
    fontSizeHeading3: d.font.sizeLg,
    fontSizeHeading4: d.font.sizeBody,
    fontSizeHeading5: d.font.sizeXs,
    boxShadow: readCssColorToken('--ds-shadow-raised'),
    boxShadowSecondary: readCssColorToken('--ds-shadow-raised'),
    boxShadowTertiary: 'none',
    motionDurationFast: d.motion.fast,
    motionDurationMid: d.motion.normal,
  };
  const derive = mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm;
  const input = { activeBorderColor: primary, hoverBorderColor: strong, activeShadow: focusShadow };
  return {
    algorithm: (seed) => ({ ...derive(seed), ...semantic, ...actionPalette }),
    token: { ...semantic, ...geometry },
    components: {
      Layout: {
        headerBg: surface,
        headerHeight: d.layout.headerHeight,
        headerPadding: `0 ${d.space.xl}px`,
        siderBg: surface,
        bodyBg: color('canvas'),
        footerBg: color('canvas'),
      },
      Menu: {
        activeBarBorderWidth: 0,
        itemBg: 'transparent',
        itemColor: muted,
        itemHoverColor: foreground,
        itemHoverBg: fill,
        itemSelectedColor: foreground,
        subMenuItemSelectedColor: foreground,
        itemSelectedBg: fill,
        itemActiveBg: fill,
        itemHeight: d.control.height,
        itemBorderRadius: d.radius.md,
        itemMarginInline: d.space.sm,
        iconSize: d.font.sizeLg,
        collapsedIconSize: d.font.sizeLg,
        groupTitleColor: muted,
        groupTitleFontSize: d.font.sizeXs,
        subMenuItemBg: 'transparent',
        darkItemBg: 'transparent',
        darkItemColor: muted,
        darkItemHoverColor: foreground,
        darkItemHoverBg: fill,
        darkItemSelectedColor: foreground,
        darkItemSelectedBg: fill,
        darkGroupTitleColor: muted,
        darkSubMenuItemBg: 'transparent',
      },
      Button: {
        controlHeight: d.control.height,
        borderRadius: d.radius.md,
        fontWeight: 500,
        defaultBg: surface,
        defaultBorderColor: border,
        defaultColor: foreground,
        defaultHoverBg: hover,
        defaultHoverBorderColor: strong,
        defaultHoverColor: foreground,
        primaryColor: inverse,
        solidTextColor: inverse,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
      },
      Card: {
        borderRadiusLG: d.radius.lg,
        paddingLG: d.space.lg,
        headerBg: 'transparent',
        headerHeight: d.control.heightLg,
        headerHeightSM: d.control.height,
        colorBorderSecondary: border,
      },
      Table: {
        headerBg: 'transparent',
        headerColor: color('text-secondary'),
        colorIcon: foreground,
        headerBorderRadius: 0,
        borderColor: border,
        rowHoverBg: hover,
        rowSelectedBg: selected,
        rowSelectedHoverBg: selected,
        cellPaddingBlock: d.space.sm,
        cellPaddingInline: d.space.md,
        headerSplitColor: 'transparent',
        footerBg: 'transparent',
      },
      Input: input,
      InputNumber: input,
      Select: {
        colorTextQuaternary: muted,
        activeBorderColor: primary,
        hoverBorderColor: strong,
        activeOutlineColor: selected,
        optionActiveBg: fill,
        optionSelectedBg: selected,
        optionSelectedColor: foreground,
      },
      DatePicker: {
        ...input,
        activeBorderColor: foreground,
        colorTextDisabled: muted,
        colorTextLightSolid: inverse,
        cellActiveWithRangeBg: selected,
      },
      Pagination: {
        itemActiveBg: selected,
        itemActiveColor: primary,
        itemActiveColorHover: primaryHover,
      },
      Progress: { defaultColor: primary, remainingColor: fill },
      Switch: {
        colorTextQuaternary: disabled,
        colorTextTertiary: muted,
        handleBg: inverse,
        colorTextLightSolid: inverse,
        trackHeight: d.control.height - d.space.md,
        trackMinWidth: d.control.height + d.space.md,
        handleSize: d.control.height - d.space.md - d.space.xs,
      },
      Spin: { colorPrimary: foreground },
      Checkbox: { colorWhite: inverse },
      Radio: { colorWhite: inverse },
      Tree: { nodeHoverBg: fill, nodeSelectedBg: selected },
      Tag: { borderRadiusSM: d.radius.xs, defaultBg: fill, defaultColor: color('text-secondary') },
      Modal: { borderRadiusLG: d.radius.lg, titleFontSize: d.font.sizeLg },
      Segmented: {
        trackBg: fill,
        trackPadding: d.space.xs,
        itemColor: muted,
        itemHoverBg: hover,
        itemHoverColor: foreground,
        itemSelectedBg: raised,
        itemSelectedColor: foreground,
      },
      Tabs: {
        itemColor: muted,
        itemSelectedColor: foreground,
        itemHoverColor: foreground,
        titleFontSize: d.font.sizeBody,
        horizontalItemGutter: d.space.xl,
      },
      Tooltip: {
        colorBgSpotlight: raised,
        colorTextLightSolid: foreground,
        borderRadius: d.radius.xs,
      },
      Form: { labelFontSize: d.font.sizeXs, itemMarginBottom: d.space.lg },
      Statistic: { titleFontSize: d.font.sizeXs, contentFontSize: d.font.sizeMetric },
    },
  };
}
export function actionColor(action: 'start' | 'pause' | 'stop') {
  const colors = { start: 'green', pause: 'orange', stop: 'danger' } as const;
  return colors[action];
}
