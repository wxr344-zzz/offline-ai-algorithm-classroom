/** Small generated charts cannot afford ECharts' default 60px top/bottom grid.
 * Keep data and chart geometry unchanged; allocate space to the plot and let
 * ECharts suppress colliding value labels rather than paint them on each other. */
export function compactChartLayout<T>(option: T, height?: number, imported = false): T {
  if (!option || imported || !height || height >= 240) return option;
  type Axis = { type?: string; axisLabel?: Record<string, unknown>; splitNumber?: number };
  const chart = option as {
    xAxis?: Axis | Axis[];
    yAxis?: Axis | Axis[];
    legend?: unknown;
    grid?: Record<string, unknown>;
    series?: { labelLayout?: Record<string, unknown> }[];
  };
  if (!chart.xAxis || !chart.yAxis) return option;
  const splitNumber = Math.max(2, Math.floor((height - 60) / 28));
  for (const axes of [chart.xAxis, chart.yAxis]) {
    for (const axis of Array.isArray(axes) ? axes : [axes]) {
      axis.axisLabel = { ...axis.axisLabel, hideOverlap: true };
      if (axis.type === 'value') axis.splitNumber = splitNumber;
    }
  }
  chart.grid = { left: 12, right: 16, top: 16, bottom: chart.legend ? 38 : 12, containLabel: true };
  for (const series of chart.series ?? [])
    series.labelLayout = { ...series.labelLayout, hideOverlap: true };
  return option;
}
