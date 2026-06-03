"use client";

import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, cn, type ButtonProps } from "@heroui/react";
import { Icon } from "@iconify/react";

export type ChartData = {
    name: string;
    [key: string]: string | number;
};

export type BarChartCardProps = {
    className?: string;
    title: string;
    color: ButtonProps["color"];
    categories: string[];
    chartData: ChartData[];
    categoryNames?: Record<string, string>;
};

export const BarChartCard = React.forwardRef<HTMLDivElement, BarChartCardProps>(
    ({ className, title, categories, color, chartData, categoryNames = {} }, ref) => {
        return (
            <Card
                ref={ref}
                className={cn("h-[360px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] shadow-[var(--kaypal-v3-card-shadow)]", className)}
            >
                <div className="flex flex-col gap-y-4 p-4">
                    <dt className="flex items-center justify-between">
                        <h3 className="text-[15px] font-bold leading-[22px] text-[var(--kaypal-v3-ink)]">{title}</h3>
                        <Dropdown placement="bottom-end">
                            <DropdownTrigger>
                                <Button isIconOnly size="sm" variant="light" className="h-8 w-8 rounded-[8px] text-[var(--kaypal-v3-muted)]">
                                    <Icon height={16} icon="solar:menu-dots-bold" width={16} />
                                </Button>
                            </DropdownTrigger>
                            <DropdownMenu variant="flat">
                                <DropdownItem key="view-details">查看详情</DropdownItem>
                                <DropdownItem key="export-data">导出数据</DropdownItem>
                            </DropdownMenu>
                        </Dropdown>
                    </dt>
                    <dd className="flex w-full justify-start gap-4 text-[11px] font-semibold leading-4 text-[var(--kaypal-v3-muted)]">
                        {categories.map((category, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <span
                                    className="h-2 w-2 rounded-full"
                                    style={{
                                        backgroundColor: `hsl(var(--heroui-${color}-${(index + 1) * 200}))`,
                                    }}
                                />
                                <span className="capitalize">{categoryNames[category] || category}</span>
                            </div>
                        ))}
                    </dd>
                </div>

                <div className="h-full w-full pb-4 pr-4">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={chartData}
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
                                        <div className="flex flex-col gap-y-2 rounded-[10px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3 text-[11px] shadow-[var(--kaypal-v3-card-shadow)]">
                                            <span className="font-semibold text-[var(--kaypal-v3-ink)]">{label}</span>
                                            {payload.map((p, index) => {
                                                const name = p.name as string;
                                                const value = p.value;
                                                const categoryText = categoryNames[name] || name;

                                                return (
                                                    <div key={`${index}-${name}`} className="flex items-center justify-between gap-x-4">
                                                        <div className="flex items-center gap-x-2">
                                                            <div
                                                                className="h-2 w-2 rounded-full"
                                                                style={{ backgroundColor: p.fill }}
                                                            />
                                                            <span className="text-[var(--kaypal-v3-muted)]">{categoryText}</span>
                                                        </div>
                                                        <span className="font-mono font-semibold text-[var(--kaypal-v3-soft-ink)]">{value}</span>
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
                    </ResponsiveContainer>
                </div>
            </Card>
        );
    }
);
BarChartCard.displayName = "BarChartCard";
