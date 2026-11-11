import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

interface Props {
  option: EChartsOption;
  height?: number | string;
  className?: string;
  onEvents?: Record<string, (params: unknown) => void>;
  ariaLabel?: string;
}

export interface EChartHandle {
  getDataURL: (backgroundColor?: string) => string | null;
}

const EChart = forwardRef<EChartHandle, Props>(function EChart(
  { option, height = "100%", className, onEvents, ariaLabel },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const inst = echarts.init(hostRef.current, undefined, {
      renderer: "canvas",
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
    instRef.current = inst;
    const ro = new ResizeObserver(() => {
      if (!inst.isDisposed()) inst.resize({ animation: { duration: 180 } });
    });
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      if (!inst.isDisposed()) inst.dispose();
      if (instRef.current === inst) instRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst || inst.isDisposed()) return;
    inst.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst || inst.isDisposed() || !onEvents) return;
    const entries = Object.entries(onEvents);
    entries.forEach(([name, handler]) => inst.on(name, handler));
    return () => {
      if (!inst.isDisposed()) entries.forEach(([name, handler]) => inst.off(name, handler));
    };
  }, [onEvents]);

  useImperativeHandle(
    ref,
    () => ({
      getDataURL: (backgroundColor = "transparent") => {
        const inst = instRef.current;
        if (!inst || inst.isDisposed()) return null;
        return inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor });
      },
    }),
    [],
  );

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ height, width: "100%" }}
      role="img"
      aria-label={ariaLabel}
    />
  );
});

export default EChart;
