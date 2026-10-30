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
  xDot: number;
  apps: Array<{ id: string; identity: string; label: string; icon: string; y: number }>;
  exits: Array<{ id: string; outbound: string; label: string; dot: string; y: number }>;
  bands: Array<{
    key: string;
    d: string;
    color: string;
    tip: string;
    application?: string;
    outbound?: string;
  }>;
}

/** 估算字符串像素宽（CJK 记 1、拉丁记 0.6 个字号单位），超宽截断加省略号。 */
function fitText(text: string, maxPx: number) {
  const units = (s: string) =>
    [...s].reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 1 : 0.6), 0);
  if (units(text) * FONT <= maxPx) return text;
  let end = text.length;
  while (end > 1 && (units(text.slice(0, end)) + 1) * FONT > maxPx) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

export function ConnectionGraph({
  flows,
  applications,
  label,
  display,
  onSelect,
}: {
  flows: ConnectionFlow[];
  applications: InstalledApplication[];
  onSelect: (selection: ConnectionSelection) => void;
  label: string;
  display: (value: string) => string;
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
      outbound === 'direct' || outbound === 'system-network'
        ? colors.success
        : outbound === 'block' || outbound === 'reject'
          ? colors.error
          : colors.textTertiary;
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
    const inner = Math.max(width - PAD * 2, 200);
    const leftW = Math.min(300, Math.max(96, Math.round(inner * 0.34)));
    const rightW = Math.min(240, Math.max(88, Math.round(inner * 0.28)));
    const xText = PAD + ICON + GAP;
    const xLeft = xText + leftW;
    const xRight = width - PAD - rightW;
    const mid = (xLeft + xRight) / 2;
    const appByPath = new Map(applications.map((application) => [application.path, application]));
    return {
      width,
      height: TOP + rows * ROW + TOP,
      xDot: xRight + 8,
      apps: apps.map(({ node, label: text }, index) => ({
        id: node.id,
        identity: node.identity ?? '',
        label: fitText(`${text} · ${formatNumber(node.value)}`, leftW),
        icon: appByPath.get(node.identity ?? '')?.iconDataUrl ?? PROCESS_ICON,
        y: rowY(index),
      })),
      exits: exits.map(({ node, label: text }, index) => ({
        id: node.id,
        outbound: node.outbound ?? '',
        label: fitText(`${text} · ${formatNumber(node.value)}`, rightW),
        dot: routeColor(node.outbound),
        y: rowY(index),
      })),
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
            d: `M ${xLeft} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${xRight} ${y2}`,
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
                strokeWidth={1.5}
                strokeOpacity={0.55}
                onMouseMove={moveTip(band.tip)}
                onMouseLeave={hideTip}
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
                <circle cx={model.xDot} cy={exit.y} r={3} fill={exit.dot} />
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
