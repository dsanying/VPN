import { forwardRef, useEffect, useRef, useState, type CSSProperties } from 'react';
import { SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { init, use as registerModules } from 'echarts/core';
import { SVGRenderer, CanvasRenderer } from 'echarts/renderers';
import type { ECharts, EChartsOption } from 'echarts';
import { useThemeStore } from '@/store/useThemeStore';

registerModules([SankeyChart, TooltipComponent, SVGRenderer, CanvasRenderer]);
interface ChartProps {
  option: EChartsOption;
  style?: CSSProperties;
  className?: string;
  renderer?: 'svg' | 'canvas';
  notMerge?: boolean;
  lazyUpdate?: boolean;
  onChartReady?: (chart: ECharts) => void;
  'data-chart-fit'?: 'content';
  'data-chart-role'?: 'realtime';
}
// Independent wrapper around public ECharts APIs; business options own geometry.
const ClientChart = forwardRef<ECharts | null, ChartProps>(({
  option, style, className, renderer = 'svg', notMerge = false, lazyUpdate = false,
  onChartReady, 'data-chart-fit': fit, 'data-chart-role': role,
}, forwarded) => {
  const element = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<ECharts | null>(null);
  const mode = useThemeStore(state => state.mode);
  useEffect(() => {
    if (!element.current) return;
    // ECharts' core and full entry publish nominally different instance types.
    const instance = init(element.current, mode === 'dark' ? 'dark' : undefined, { renderer }) as unknown as ECharts;
    setChart(instance);
    if (typeof forwarded === 'function') forwarded(instance);
    else if (forwarded) forwarded.current = instance;
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { if (!instance.isDisposed()) instance.resize(); });
    });
    observer.observe(element.current);
    return () => {
      observer.disconnect(); cancelAnimationFrame(resizeFrame); instance.dispose();
      if (typeof forwarded === 'function') forwarded(null);
      else if (forwarded) forwarded.current = null;
    };
  }, [mode, renderer, forwarded]);
  useEffect(() => {
    if (!chart || chart.isDisposed()) return;
    chart.setOption({ ...option, backgroundColor: 'transparent' }, { notMerge, lazyUpdate });
  }, [chart, option, notMerge, lazyUpdate]);
  useEffect(() => { if (chart && !chart.isDisposed()) onChartReady?.(chart); }, [chart, onChartReady]);
  return <div ref={element} className={className} style={{ width: '100%', height: 336, ...style }} data-chart-fit={fit} data-chart-role={role} />;
});
ClientChart.displayName = 'ClientChart';
export default ClientChart;
