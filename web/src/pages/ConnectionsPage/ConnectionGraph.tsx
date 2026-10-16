import { nodeDisplayName, nodeGroupName, nodeRegionCode, nodeRegionEvidence, resolveNodeIdentity } from '@shared/node-identity';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/app-store';
import { useCallback, useMemo } from 'react';
import type { ECharts } from 'echarts';
import type { EChartsOption, SankeySeriesOption } from 'echarts';
import ReactECharts from '@/components/ReactEcharts';
import { useChartColors } from '@/components/ReactEcharts/useChartColors';
import {
  CHART_HEIGHT,
  REALTIME_CHART_HEIGHT,
  valueLabelGridRight,
} from '@/components/ReactEcharts/chartOptions';
import { ScrollRegion } from '@/components/client';
import { designTokens } from '@/design/tokens';
import type { InstalledApplication } from '@shared/types';
import { PROCESS_ICON } from '@shared/application-icon';
import { connectionSankey, UNKNOWN_OUTBOUND, type ConnectionFlow } from '@shared/live-traffic';
import { formatNumber } from '@/utils/number';
import './ConnectionGraph.css';

export interface ConnectionSelection {
  application?: string;
  outbound?: string;
}

/** Actual connection counts determine band width; all groups and shared exits remain available. */
export function ConnectionGraph({
  flows,
  applications,
  source,
  label,
  display,
  onSelect,
}: {
  flows: ConnectionFlow[];
  applications: InstalledApplication[];
  onSelect: (selection: ConnectionSelection) => void;
  source: string;
  label: string;
  display: (value: string) => string;
}) {
  const colors = useChartColors();
  const { t } = useTranslation();
  const servers = useAppStore((s) => s.config?.servers);
  const subscriptions = useAppStore((s) => s.config?.subscriptions);
  const details = useAppStore((s) => s.probeDetails);
  const graph = useMemo(() => connectionSankey(flows, source), [flows, source]);
  const rows = Math.max(
    graph.nodes.filter((n) => n.depth === 1).length,
    graph.nodes.filter((n) => n.depth === 2).length
  );
  // Enough spacing for the smallest branch's label, even when a dominant route carries most connections.
  const height = Math.max(
    REALTIME_CHART_HEIGHT,
    rows * designTokens.space.xxxl + designTokens.space.xl * 2
  );
  const option = useMemo<EChartsOption>(() => {
    const routeColor = (outbound?: string) =>
      outbound === 'direct' || outbound === 'system-network'
        ? colors.success
        : outbound === 'block' || outbound === 'reject'
          ? colors.error
          : outbound === UNKNOWN_OUTBOUND
            ? colors.textTertiary
            : colors.info;
    const nodeName = (n: (typeof graph.nodes)[number]) => {
      const node = n.depth === 2 ? resolveNodeIdentity(n.name, servers ?? []) : undefined;
      return node
        ? nodeDisplayName(
            node.name,
            nodeRegionCode(details[node.id]),
            nodeGroupName(node, subscriptions, {
              manual: t('common.vocab.manualNodes'),
              mesh: t('common.vocab.meshNetworking'),
            })
          ) + (nodeRegionEvidence(details[node.id])?.source === 'gateway' ? ` · ${t('vpn.gatewayRegion')}` : '')
        : display(n.name);
    };
    const appByPath = new Map(applications.map((application) => [application.path, application]));
    const names = new Map(graph.nodes.map((n) => [n.id, nodeName(n)]));
    const data: SankeySeriesOption['data'] = graph.nodes.map((n) => {
      const application = n.depth === 1 ? appByPath.get(n.identity ?? '') : undefined;
      const name = names.get(n.id)!;
      const caption = `${name} · ${formatNumber(n.value)}`;
      return {
        id: n.id,
        name,
        value: n.value,
        depth: n.depth,
        itemStyle: { color: n.depth === 2 ? routeColor(n.outbound) : colors.info },
        label: {
          position: n.depth === 0 ? 'left' : 'right',
          formatter: n.depth === 1 ? `{icon|} {caption|${caption}}` : caption,
          ...(n.depth === 1
            ? {
                rich: {
                  icon: {
                    width: designTokens.space.xl,
                    height: designTokens.space.xl,
                    color: colors.textSecondary,
                    backgroundColor: { image: application?.iconDataUrl ?? PROCESS_ICON },
                  },
                  caption: {
                    color: colors.text,
                    width:
                      designTokens.layout.detailAsideWidth -
                      designTokens.space.xl -
                      designTokens.space.sm,
                    overflow: 'truncate' as const,
                  },
                },
              }
            : {}),
        },
      };
    });
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const links: SankeySeriesOption['links'] = graph.links.map((link) => ({
      ...link,
      // ECharts' built-in edge tooltip otherwise shows internal node IDs. A native name template uses this readable edge name.
      id: `${names.get(link.source)} → ${names.get(link.target)} · ${formatNumber(link.value)}`,
      tooltip: { formatter: '{b}' },
      lineStyle: { color: routeColor(byId.get(link.target)?.outbound) },
    }));
    return {
      animation: false,
      tooltip: { valueFormatter: (value) => formatNumber(value) },
      series: [
        {
          type: 'sankey',
          data,
          links,
          nodeAlign: 'justify',
          layoutIterations: 0,
          nodeGap: designTokens.space.xl,
          nodeWidth: designTokens.space.lg,
          lineStyle: { opacity: 0.35, curveness: 0.5 },
          left: valueLabelGridRight([`${source} · ${formatNumber(graph.nodes[0].value)}`]),
          right: designTokens.layout.queryControlWidth,
          top: designTokens.space.xl,
          bottom: designTokens.space.xl,
          draggable: false,
          label: {
            show: true,
            fontSize: designTokens.font.sizeXs,
            fontFamily: designTokens.font.family,
            color: colors.text,
            width: designTokens.layout.detailAsideWidth,
            overflow: 'truncate',
          },
        },
      ],
    };
  }, [graph, applications, display, colors, source, servers, subscriptions, details, t]);
  const bindChart = useCallback(
    (chart: ECharts) => {
      chart.off('click');
      chart.on('click', (event: { dataType?: string; dataIndex?: number }) => {
        if (event.dataIndex === undefined) return;
        if (event.dataType === 'edge') {
          const link = graph.links[event.dataIndex];
          if (!link) return;
          const from = graph.nodes.find((n) => n.id === link.source);
          const to = graph.nodes.find((n) => n.id === link.target);
          onSelect({ application: from?.identity ?? to?.identity, outbound: to?.outbound });
        } else {
          const node = graph.nodes[event.dataIndex];
          if (node) onSelect({ application: node.identity, outbound: node.outbound });
        }
      });
    },
    [graph, onSelect]
  );
  return (
    <ScrollRegion
      axis="both"
      label={label}
      className="vpn-connection-graph"
      style={{ height: Math.min(CHART_HEIGHT, height) }}
    >
      <ReactECharts
        option={option}
        onChartReady={bindChart}
        renderer="svg"
        style={{ height }}
        data-chart-fit="content"
        notMerge
      />
    </ScrollRegion>
  );
}
