import {
  Clock3,
  Database,
  Filter,
} from "lucide-react";
import { type IntelligencePageConfig } from "../data";

type IntelligencePageShellProps = {
  page: IntelligencePageConfig;
};

export function IntelligencePageShell({ page }: IntelligencePageShellProps) {
  const PageIcon = page.icon;

  return (
    <div className="flex flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <header className="p-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <PageIcon
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">{page.eyebrow}</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  {page.title}
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  {page.description}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <label className="block">
                <span className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  {page.commandTitle}
                </span>
                <input
                  className="mt-1 h-10 w-full rounded-[8px] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-13 text-[var(--kaypal-v3-ink)] outline-none transition focus:border-[var(--kaypal-v3-accent)] focus:shadow-[var(--kaypal-v3-field-shadow-focus)]"
                  placeholder={page.commandPlaceholder}
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2.5 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                <Filter aria-hidden="true" className="h-3.5 w-3.5" />
                筛选
              </span>
              {page.filters.map((filter) => (
                <button
                  className="h-7 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-muted)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-soft-ink)]"
                  key={filter}
                  type="button"
                >
                  {filter}
                </button>
              ))}
            </div>

        </header>
      </section>

      <section>
        <article className="kaypal-v3-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--kaypal-v3-border)] p-4">
            <div>
              <p className="kaypal-v3-label">来源和节奏</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                可用来源
              </h2>
            </div>
            <Database
              aria-hidden="true"
              className="h-5 w-5 text-[var(--kaypal-v3-muted)]"
              strokeWidth={1.8}
            />
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {page.sources.map((source) => (
              <div className="p-4" key={source.name}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {source.name}
                    </h3>
                    <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {source.scope}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-1 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                    <Clock3 aria-hidden="true" className="h-3 w-3" />
                    {source.cadence}
                  </span>
                </div>
                <p className="mt-2 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  负责人：{source.owner}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <p className="kaypal-v3-label">落地表</p>
          <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
            {page.table.title}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-13">
            <thead className="bg-[var(--kaypal-v3-table-head)] text-11 font-bold text-[var(--kaypal-v3-muted)]">
              <tr>
                {page.table.columns.map((column) => (
                  <th className="px-4 py-3" key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kaypal-v3-border)]">
              {page.table.rows.map((row) => (
                <tr key={row.join("-")}>
                  {row.map((cell, index) => (
                    <td
                      className={[
                        "px-4 py-3 align-top leading-5 text-[var(--kaypal-v3-soft-ink)]",
                        index === 0
                          ? "font-bold text-[var(--kaypal-v3-ink)]"
                          : "",
                      ].join(" ")}
                      key={`${row.join("-")}-${cell}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
