import {
  nodeDisplayName,
  nodeGroupName,
  nodeRegionCode,
  nodeRegionEvidence,
  resolveNodeIdentity,
} from '@shared/node-identity';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/app-store';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ScrollRegion } from '@/components/client';
import { useChartColors } from '@/components/ReactEcharts/useChartColors';
import { CHART_HEIGHT, REALTIME_CHART_HEIGHT } from '@/components/ReactEcharts/chartOptions';
import { designTokens } from '@/design/tokens';
import type { InstalledApplication } from '@shared/types';
import { PROCESS_ICON } from '@shared/application-icon';
import { connectionSankey, type ConnectionFlow } from '@shared/live-traffic';
import { formatNumber } from '@/utils/number';
import './ConnectionGraph.css';

export interface ConnectionSelection {
  application?: string;
  outbound?: string;
}

/**
 * 固定两列挂线图：应用一列、出口一列，连线等宽细线。
 * 行高与列位置只由「有哪些应用/出口」决定，与连接数无关——字节与连接数变化不会移动任何元素，
 * 数量只体现在标签文字里（对比旧桑基图按连接数定宽导致的持续抖动）。
 */
const ROW = 30;
const ICON = 16;
const GAP = 6;
const FONT = designTokens.font.sizeXs;
const TOP = designTokens.space.lg;
const PAD = designTokens.space.xl;

interface GraphModel {
  width: number;
  height: number;
  apps: Array<{ id: string; identity: string; label: string; icon: string; y: number; ax: number }>;
  exits: Array<{ id: string; outbound: string; label: string; dot: string; y: number; ax: number }>;
  bands: Array<{
    key: string;
    d: string;
    w: number;
    color: string;
    tip: string;
    application?: string;
    outbound?: string;
  }>;
}

/** 锚点小圆点与文字的间距。 */
const ANCHOR_GAP = 8;
/** 锚点到中线两侧的最小距离：保证任意连线带区 ≥88px（测试按 path 宽 >80 识别挂线）。 */
const ANCHOR_CLAMP = 44;

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** canvas 实测文字像素宽；同字体同文字结果确定，保证字节更新重渲染零 DOM 变更。 */
function measureText(text: string): number {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (measureCtx) measureCtx.font = `${FONT}px ${designTokens.font.family}`;
  }
  if (!measureCtx) {
    // 无 canvas 环境（SSR/测试降级）：CJK 记 1、拉丁记 0.6 个字号单位。
    const units = [...text].reduce(
      (sum, ch) => sum + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 1 : 0.6),
      0
    );
    return units * FONT;
  }
  return measureCtx.measureText(text).width;
}

/** canvas 实测宽度截断标签，超宽加省略号。 */
function fitText(text: string, maxPx: number) {
  if (measureText(text) <= maxPx) return text;
  let end = text.length;
  while (end > 1 && measureText(`${text.slice(0, end).trimEnd()}…`) > maxPx) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

export function ConnectionGraph({
  flows,
  applications,
  label,
  display,
  onSelect,
  selection,
}: {
  flows: ConnectionFlow[];
  applications: InstalledApplication[];
  onSelect: (selection: ConnectionSelection) => void;
  label: string;
  display: (value: string) => string;
  selection?: ConnectionSelection;
}) {
  const colors = useChartColors();
  const { t } = useTranslation();
  const servers = useAppStore((s) => s.config?.servers);
  const subscriptions = useAppStore((s) => s.config?.subscriptions);
  const details = useAppStore((s) => s.probeDetails);
  const graph = useMemo(() => connectionSankey(flows), [flows]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [hover, setHover] = useState<ConnectionSelection | null>(null);
  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  const model = useMemo<GraphModel | null>(() => {
    if (!width) return null;
    const routeColor = (outbound?: string) =>
      // 配色语义：代理节点绿色（流量主角色）、直连灰色（背景流量）、阻断红色。
      outbound === 'block' || outbound === 'reject'
        ? colors.error
        : outbound === 'direct' || outbound === 'system-network'
          ? colors.textTertiary
          : colors.success;
    // 标签文案与旧图一致：出口解析节点身份补地区/分组，其余走 display。
    const caption = (n: (typeof graph.nodes)[number]) => {
      const node = n.depth === 1 ? resolveNodeIdentity(n.name, servers ?? []) : undefined;
      return node
        ? nodeDisplayName(
            node.name,
            nodeRegionCode(details[node.id]),
            nodeGroupName(node, subscriptions, {
              manual: t('common.vocab.manualNodes'),
              mesh: t('common.vocab.meshNetworking'),
            })
          ) +
            (nodeRegionEvidence(details[node.id])?.source === 'gateway'
              ? ` · ${t('vpn.gatewayRegion')}`
              : '')
        : display(n.name);
    };
    const rowY = (index: number) => TOP + index * ROW + ROW / 2;
    const apps = graph.nodes
      .filter((n) => n.depth === 0)
      .map((node) => ({ node, label: caption(node) }))
      // 按名称排序：新应用出现只插入自己的位置，不重排既有行（首次出现序会整列抖动）。
      .sort((a, b) => a.label.localeCompare(b.label));
    const appIndex = new Map(apps.map((app, index) => [app.node.id, index]));
    // 出口锚在所连应用的平均行高附近：交叉最少；顺序稳定，与连接数无关。
    const wanted = new Map<string, { sum: number; count: number }>();
    for (const link of graph.links) {
      const index = appIndex.get(link.source);
      if (index === undefined) continue;
      const entry = wanted.get(link.target) ?? { sum: 0, count: 0 };
      entry.sum += rowY(index);
      entry.count += 1;
      wanted.set(link.target, entry);
    }
    const exits = graph.nodes
      .filter((n) => n.depth === 1)
      .map((node) => ({
        node,
        label: caption(node),
        desired: wanted.get(node.id)
          ? wanted.get(node.id)!.sum / wanted.get(node.id)!.count
          : rowY(0),
      }))
      .sort((a, b) => a.desired - b.desired || a.label.localeCompare(b.label));
    const exitIndex = new Map(exits.map((exit, index) => [exit.node.id, index]));
    const rows = Math.max(1, apps.length, exits.length);
    // 锚点直接挂在本行文字旁：应用文字左起，出口文字右对齐，锚点在文字末侧 8px 处。
    // 带区（两条锚点之间的连线区域）以中线对称，锚点向中线 clamp 保证带区 ≥2×ANCHOR_CLAMP。
    const xText = PAD + ICON + GAP;
    const xEnd = width - PAD;
    const mid = (xText + xEnd) / 2;
    const appByPath = new Map(applications.map((application) => [application.path, application]));
    const appMax = Math.max(24, mid - ANCHOR_CLAMP - ANCHOR_GAP - xText);
    const exitMax = Math.max(24, xEnd - (mid + ANCHOR_CLAMP) - ANCHOR_GAP);
    const appsModel = apps.map(({ node, label: text }, index) => {
      const label = fitText(`${text} · ${formatNumber(node.value)}`, appMax);
      return {
        id: node.id,
        identity: node.identity ?? '',
        label,
        icon: appByPath.get(node.identity ?? '')?.iconDataUrl ?? PROCESS_ICON,
        y: rowY(index),
        ax: Math.min(xText + measureText(label) + ANCHOR_GAP, mid - ANCHOR_CLAMP),
      };
    });
    const exitsModel = exits.map(({ node, label: text }, index) => {
      const label = fitText(`${text} · ${formatNumber(node.value)}`, exitMax);
      return {
        id: node.id,
        outbound: node.outbound ?? '',
        label,
        dot: routeColor(node.outbound),
        y: rowY(index),
        ax: Math.max(xEnd - measureText(label) - ANCHOR_GAP, mid + ANCHOR_CLAMP),
      };
    });
    // 连线宽度按连接数 3–10px：把旧桑基图「流量一眼可见」的信息量带回来，
    // 只跟连接数走，与字节无关（字节更新不改变任何元素，零重绘契约不变）。
    const maxLink = Math.max(1, ...graph.links.map((link) => link.value));
    return {
      width,
      height: TOP + rows * ROW + TOP,
      apps: appsModel,
      exits: exitsModel,
      bands: graph.links.flatMap((link) => {
        const from = graph.nodes.find((n) => n.id === link.source);
        const to = graph.nodes.find((n) => n.id === link.target);
        const app = appIndex.get(link.source);
        const exit = exitIndex.get(link.target);
        if (!from || !to || app === undefined || exit === undefined) return [];
        const y1 = rowY(app);
        const y2 = rowY(exit);
        const application = apps[app].label;
        const outbound = exits[exit].label;
        return [
          {
            key: `${link.source}->${link.target}`,
            d: `M ${appsModel[app].ax} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${exitsModel[exit].ax} ${y2}`,
            w: 3 + 7 * (link.value / maxLink),
            color: routeColor(to.outbound),
            tip: `${application} → ${outbound} · ${formatNumber(link.value)}`,
            application: from.identity,
            outbound: to.outbound,
          },
        ];
      }),
    };
  }, [graph, width, applications, display, colors, servers, subscriptions, details, t]);
  const moveTip = (text: string) => (event: ReactMouseEvent) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (rect) setTip({ x: event.clientX - rect.left + 12, y: event.clientY - rect.top + 12, text });
  };
  const hideTip = () => setTip(null);
  // 高亮焦点：悬停优先，其次页面当前的筛选选中。命中流向全亮，其余压暗。
  const focus = hover?.application || hover?.outbound ? hover : selection;
  const hasFocus = Boolean(focus?.application || focus?.outbound);
  const bandOpacity = (band: { application?: string; outbound?: string }) => {
    if (!hasFocus) return 0.55;
    const active =
      (focus?.application && band.application === focus.application) ||
      (focus?.outbound && band.outbound === focus.outbound);
    return active ? 0.95 : 0.15;
  };
  const height = Math.min(CHART_HEIGHT, Math.max(REALTIME_CHART_HEIGHT, model?.height ?? 0));
  return (
    <ScrollRegion axis="both" label={label} className="vpn-connection-graph" style={{ height }}>
      <div ref={hostRef} className="vpn-connection-graph__host">
        {model ? (
          <svg
            width={model.width}
            height={model.height}
            data-chart-fit="content"
            role="img"
            aria-label={label}
          >
            {model.bands.map((band) => (
              <path
                key={band.key}
                className="vpn-connection-graph__band"
                d={band.d}
                fill="none"
                stroke={band.color}
                strokeWidth={band.w}
                strokeLinecap="round"
                strokeOpacity={bandOpacity(band)}
                onMouseMove={moveTip(band.tip)}
                onMouseEnter={() => setHover({ application: band.application, outbound: band.outbound })}
                onMouseLeave={() => {
                  setHover(null);
                  hideTip();
                }}
                onClick={() => onSelect({ application: band.application, outbound: band.outbound })}
              />
            ))}
            {model.apps.map((app) => (
              <g
                key={app.id}
                className="vpn-connection-graph__node"
                onMouseMove={moveTip(app.label)}
                onMouseLeave={hideTip}
                onClick={() => onSelect({ application: app.identity })}
              >
                <image href={app.icon} x={PAD} y={app.y - ICON / 2} width={ICON} height={ICON} />
                <text
                  x={PAD + ICON + GAP}
                  y={app.y}
                  fill={colors.text}
                  fontSize={FONT}
                  fontFamily={designTokens.font.family}
                  dominantBaseline="central"
                >
                  {app.label}
                </text>
                <circle cx={app.ax} cy={app.y} r={3} fill={colors.info} />
              </g>
            ))}
            {model.exits.map((exit) => (
              <g
                key={exit.id}
                className="vpn-connection-graph__node"
                onMouseMove={moveTip(exit.label)}
                onMouseLeave={hideTip}
                onClick={() => onSelect({ outbound: exit.outbound })}
              >
                <circle cx={exit.ax} cy={exit.y} r={3} fill={exit.dot} />
                <text
                  x={model.width - PAD}
                  y={exit.y}
                  fill={colors.text}
                  fontSize={FONT}
                  fontFamily={designTokens.font.family}
                  dominantBaseline="central"
                  textAnchor="end"
                >
                  {exit.label}
                </text>
              </g>
            ))}
          </svg>
        ) : null}
        {tip ? (
          <div className="vpn-connection-graph__tip" style={{ left: tip.x, top: tip.y }}>
            {tip.text}
          </div>
        ) : null}
      </div>
    </ScrollRegion>
  );
}
