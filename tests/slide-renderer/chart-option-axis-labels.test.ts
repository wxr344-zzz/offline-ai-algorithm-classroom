import { describe, expect, it } from 'vitest';

import { getChartOption as getAppChartOption } from '@/components/slide-renderer/components/element/ChartElement/chartOption';
import { getChartOption as getPackageChartOption } from '@/packages/@openmaic/renderer/src/elements/chart/chartOption';

const chartOptionFactories = [getAppChartOption, getPackageChartOption];

describe('Chart category axis labels', () => {
  it.each(chartOptionFactories)(
    'allocates a real plot to the reported 139px chart',
    (getChartOption) => {
      const data = {
        labels: ['光照强度', 'CO2浓度', '温度'],
        legends: ['光合速率'],
        series: [[10, 40, 100]],
      };
      const option = getChartOption({
        type: 'bar',
        data,
        themeColors: ['#5b9bd5'],
        height: 139.3667,
      }) as {
        grid: { top: number; bottom: number; containLabel: boolean };
        yAxis: { splitNumber: number; axisLabel: { hideOverlap: boolean } };
        series: { data: number[]; labelLayout: { hideOverlap: boolean } }[];
      };
      expect(option.grid).toMatchObject({ top: 16, bottom: 12, containLabel: true });
      expect(139.3667 - option.grid.top - option.grid.bottom).toBeGreaterThan(100);
      expect(option.yAxis.splitNumber).toBe(2);
      expect(option.yAxis.axisLabel.hideOverlap).toBe(true);
      expect(option.series[0].labelLayout.hideOverlap).toBe(true);
      expect(option.series[0].data).toEqual([10, 40, 100]);
    },
  );
  it.each(chartOptionFactories)(
    'keeps every category visible when no explicit text color is provided',
    (getChartOption) => {
      const option = getChartOption({
        type: 'column',
        data: {
          labels: ['木块', '铁块', '塑料'],
          legends: ['浮力/N'],
          series: [[20, 12, 16]],
        },
        themeColors: ['#5b9bd5'],
      }) as {
        xAxis: { axisLabel: Record<string, unknown> };
        yAxis: { axisLabel: Record<string, unknown> };
      };

      expect(option.yAxis.axisLabel).toEqual({
        show: true,
        color: '#333333',
        interval: 0,
      });
      expect(option.xAxis.axisLabel).toEqual({ show: true, color: '#333333' });
    },
  );

  it.each(chartOptionFactories)('lets ECharts thin dense category labels', (getChartOption) => {
    const labels = Array.from({ length: 20 }, (_, index) => `Category ${index + 1}`);
    const option = getChartOption({
      type: 'bar',
      data: {
        labels,
        legends: ['Value'],
        series: [labels.map((_, index) => index + 1)],
      },
      themeColors: ['#5b9bd5'],
    }) as { xAxis: { axisLabel: Record<string, unknown> } };

    expect(option.xAxis.axisLabel).toEqual({
      show: true,
      color: '#333333',
      interval: 'auto',
    });
  });

  it.each(chartOptionFactories)(
    'returns null for malformed legacy data before reading category labels',
    (getChartOption) => {
      const malformedData = [undefined, { legends: ['Value'], series: [[1]] }] as unknown as Array<
        Parameters<typeof getChartOption>[0]['data']
      >;

      for (const data of malformedData) {
        expect(
          getChartOption({
            type: 'bar',
            data,
            themeColors: ['#5b9bd5'],
          }),
        ).toBeNull();
      }
    },
  );
});
