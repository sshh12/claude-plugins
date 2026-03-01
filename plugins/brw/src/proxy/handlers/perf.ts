import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

export async function handlePerf(
  cdp: CDPManager,
  params: {
    tab?: string;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  const { metrics: rawMetrics } = await client.Performance.getMetrics();

  // Build a structured metrics object
  const metricsMap: Record<string, number> = {};
  for (const m of rawMetrics) {
    metricsMap[m.name] = m.value;
  }

  const metrics = {
    // Timing
    domContentLoaded: metricsMap.DomContentLoaded || 0,
    loadEvent: metricsMap.NavigationStart
      ? (metricsMap.LoadEventEnd || 0) - metricsMap.NavigationStart
      : 0,
    firstContentfulPaint: metricsMap.FirstContentfulPaint || 0,

    // DOM
    domNodes: metricsMap.Nodes || 0,
    domDepth: metricsMap.LayoutDuration ? undefined : undefined,

    // JavaScript
    jsHeapUsedSize: metricsMap.JSHeapUsedSize || 0,
    jsHeapTotalSize: metricsMap.JSHeapTotalSize || 0,
    scriptDuration: metricsMap.ScriptDuration || 0,
    taskDuration: metricsMap.TaskDuration || 0,

    // Layout
    layoutCount: metricsMap.LayoutCount || 0,
    layoutDuration: metricsMap.LayoutDuration || 0,
    recalcStyleCount: metricsMap.RecalcStyleCount || 0,
    recalcStyleDuration: metricsMap.RecalcStyleDuration || 0,

    // Resources
    documents: metricsMap.Documents || 0,
    frames: metricsMap.Frames || 0,
    jsEventListeners: metricsMap.JSEventListeners || 0,
  };

  return { ok: true, metrics };
}
