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

  // CDP Performance.getMetrics — may return stale navigation-time counters on SPAs
  const { metrics: rawMetrics } = await client.Performance.getMetrics();
  const metricsMap: Record<string, number> = {};
  for (const m of rawMetrics) {
    metricsMap[m.name] = m.value;
  }

  // Supplement with Runtime.evaluate for live metrics (SPAs, long-lived pages)
  let runtimeMetrics: any = {};
  try {
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        var m = {};
        // Navigation timing
        var nav = performance.getEntriesByType('navigation');
        if (nav && nav.length) {
          m.navDomContentLoaded = nav[0].domContentLoadedEventEnd;
          m.navLoadEvent = nav[0].loadEventEnd;
          m.navDuration = nav[0].duration;
        }
        // Paint timing
        var paints = performance.getEntriesByType('paint');
        for (var i = 0; i < paints.length; i++) {
          if (paints[i].name === 'first-contentful-paint') m.fcp = paints[i].startTime;
          if (paints[i].name === 'first-paint') m.fp = paints[i].startTime;
        }
        // Memory
        if (performance.memory) {
          m.jsHeapUsedSize = performance.memory.usedJSHeapSize;
          m.jsHeapTotalSize = performance.memory.totalJSHeapSize;
        }
        // Live DOM metrics
        m.domNodes = document.querySelectorAll('*').length;
        // DOM depth walk
        var maxD = 0;
        function walk(el, d) {
          if (d > maxD) maxD = d;
          for (var c = el.firstElementChild; c; c = c.nextElementSibling) walk(c, d + 1);
        }
        walk(document.documentElement, 0);
        m.domDepth = maxD;
        return JSON.stringify(m);
      })()`,
      returnByValue: true,
      timeout: 5000,
    });
    if (result.result?.value) {
      runtimeMetrics = JSON.parse(result.result.value);
    }
  } catch {
    // Runtime eval failed — fall back to CDP-only metrics
  }

  const metrics = {
    // Timing — prefer runtime navigation entries
    domContentLoaded: runtimeMetrics.navDomContentLoaded || metricsMap.DomContentLoaded || 0,
    loadEvent: runtimeMetrics.navLoadEvent || (metricsMap.NavigationStart
      ? (metricsMap.LoadEventEnd || 0) - metricsMap.NavigationStart
      : 0),
    firstContentfulPaint: runtimeMetrics.fcp || metricsMap.FirstContentfulPaint || 0,

    // DOM — prefer live counts
    domNodes: runtimeMetrics.domNodes || metricsMap.Nodes || 0,
    domDepth: runtimeMetrics.domDepth || 0,

    // JavaScript — prefer runtime memory
    jsHeapUsedSize: runtimeMetrics.jsHeapUsedSize || metricsMap.JSHeapUsedSize || 0,
    jsHeapTotalSize: runtimeMetrics.jsHeapTotalSize || metricsMap.JSHeapTotalSize || 0,
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
