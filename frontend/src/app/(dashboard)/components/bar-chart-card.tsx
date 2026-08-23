"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Card, cn, type ButtonProps } from "@heroui/react";
export type ChartData = { name: string; [key: string]: string | number };
export type BarChartCardProps = {
  className?: string;
  title: string;
  color: ButtonProps["color"];
  categories: string[];
  chartData: ChartData[];
  categoryNames?: Record<string, string>;
};
export const BarChartCard = React.forwardRef<HTMLDivElement, BarChartCardProps>(
  (
    { className, title, categories, color, chartData, categoryNames = {} },
    ref,
  ) => {
    const chartAreaRef = React.useRef<HTMLDivElement | null>(null);
    const [chartWidth, setChartWidth] = React.useState(0);

    React.useEffect(() => {
      const element = chartAreaRef.current;
      if (!element) return;

      const updateWidth = () => {
        setChartWidth(Math.floor(element.getBoundingClientRect().width));
      };

      updateWidth();
      const observer = new ResizeObserver(updateWidth);
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    const effectiveChartWidth = Math.max(320, chartWidth);

    return (
      <Card
        ref={ref}
        className={cn(
          "flex h-[360px] flex-col border border-transparent bg-content1 shadow-sm dark:border-default-100",
          className,
        )}
      >
        <div className="flex flex-col gap-y-4 p-4">
          <dt className="flex items-center justify-between">
            <h3 className="text-14 font-bold leading-[22px] text-default-700">
              {title}
            </h3>
          </dt>
          <dd className="flex w-full justify-start gap-4 text-11 font-semibold leading-4 text-default-500">
            {categories.map((category, index) => (
              <div key={index} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: `hsl(var(--heroui-${color}-${(index + 1) * 200}))`,
                  }}
                />
                <span className="capitalize">
                  {categoryNames[category] || category}
                </span>
              </div>
            ))}
          </dd>
        </div>
        <div
          ref={chartAreaRef}
          className="min-h-[250px] min-w-0 flex-1 overflow-hidden pb-4 pr-4"
        >
          {chartWidth > 0 ? (
            <BarChart
              data={chartData}
              width={effectiveChartWidth}
              height={250}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <XAxis
                dataKey="name"
                strokeOpacity={0.25}
                style={{ fontSize: "12px" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                style={{ fontSize: "12px" }}
                width={40}
              />
              <Tooltip
                cursor={{ fill: "transparent" }}
                content={({ label, payload }) => {
                  if (!payload || payload.length === 0) return null;
                  return (
                    <div className="flex flex-col gap-y-2 rounded-[8px] border border-default-100 bg-background p-3 text-11 shadow-small">
                      <span className="font-semibold text-foreground">
                        {label}
                      </span>
                      {payload.map((p, index) => {
                        const name = p.name as string;
                        const value = p.value;
                        const categoryText = categoryNames[name] || name;
                        return (
                          <div
                            key={`${index}-${name}`}
                            className="flex items-center justify-between gap-x-4"
                          >
                            <div className="flex items-center gap-x-2">
                              <div
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: p.fill }}
                              />
                              <span className="text-default-500">
                                {categoryText}
                              </span>
                            </div>
                            <span className="font-mono font-semibold text-default-700">
                              {value}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              {categories.map((category, index) => (
                <Bar
                  key={category}
                  dataKey={category}
                  fill={`hsl(var(--heroui-${color}-${(index + 1) * 200}))`}
                  radius={[4, 4, 0, 0]}
                  barSize={16}
                />
              ))}
            </BarChart>
          ) : null}
        </div>
      </Card>
    );
  },
);
BarChartCard.displayName = "BarChartCard";
