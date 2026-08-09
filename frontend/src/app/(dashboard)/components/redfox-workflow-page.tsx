import Link from "next/link";
import { ArrowRight, CheckCircle2, type LucideIcon } from "lucide-react";

type WorkflowMetric = {
  label: string;
  value: string;
  detail: string;
};

type WorkflowPanel = {
  title: string;
  description: string;
  items: string[];
};

type WorkflowPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  primaryAction: string;
  primaryHref: string;
  secondaryAction: string;
  secondaryHref: string;
  metrics: WorkflowMetric[];
  panels: WorkflowPanel[];
  rows: Array<[string, string, string]>;
};

export function RedfoxWorkflowPage({
  eyebrow,
  title,
  description,
  icon: Icon,
  primaryAction,
  primaryHref,
  secondaryAction,
  secondaryHref,
  metrics,
  panels,
  rows,
}: WorkflowPageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="kaypal-v3-page-header flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="kaypal-v3-icon-tile shrink-0">
            <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <span className="kaypal-v3-label">{eyebrow}</span>
            <h1 className="mt-1 text-[22px] font-bold leading-8 text-[var(--kaypal-v3-ink)]">
              {title}
            </h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
              {description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Link
            className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-[13px] font-semibold text-white"
            href={primaryHref}
          >
            {primaryAction}
            <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
          </Link>
          <Link
            className="inline-flex h-8 items-center rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[13px] font-semibold text-[var(--kaypal-v3-soft-ink)]"
            href={secondaryHref}
          >
            {secondaryAction}
          </Link>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        {metrics.map((metric) => (
          <article className="kaypal-v3-panel p-4" key={metric.label}>
            <p className="kaypal-v3-label">{metric.label}</p>
            <strong className="mt-2 block text-[24px] leading-8 text-[var(--kaypal-v3-ink)]">
              {metric.value}
            </strong>
            <p className="mt-2 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
              {metric.detail}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {panels.map((panel) => (
          <article className="kaypal-v3-panel p-4" key={panel.title}>
            <h2 className="text-[15px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
              {panel.title}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
              {panel.description}
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {panel.items.map((item) => (
                <div className="flex items-start gap-2" key={item}>
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]"
                    strokeWidth={1.8}
                  />
                  <span className="text-[13px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <h2 className="text-[15px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            落地进度
          </h2>
          <p className="text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
            当前入口已可使用，后续动作会继续沉淀到任务结果和结果留存。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[13px]">
            <thead className="bg-[var(--kaypal-v3-table-head)] text-[11px] font-bold text-[var(--kaypal-v3-muted)]">
              <tr>
                <th className="px-4 py-3" scope="col">能力</th>
                <th className="px-4 py-3" scope="col">业务入口</th>
                <th className="px-4 py-3" scope="col">当前进度</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kaypal-v3-border)]">
              {rows.map(([capability, endpoint, status]) => (
                <tr key={capability}>
                  <td className="px-4 py-3 font-semibold text-[var(--kaypal-v3-ink)]">
                    {capability}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[var(--kaypal-v3-muted)]">
                    {endpoint}
                  </td>
                  <td className="px-4 py-3 text-[var(--kaypal-v3-soft-ink)]">
                    {status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
