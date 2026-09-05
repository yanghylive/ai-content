# -*- coding: utf-8 -*-
import io
def patch(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == count, 'MISS %s: %r x%d' % (path.split('/')[-1], old[:48], n)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok', path.split('/')[-1])

P = '/Users/yanghy/Documents/New project/ai-content/frontend/src/app/(dashboard)/growth/leads/detail/page.tsx'

# 1) 类型导入
patch(P, """  type LeadAttributionDto,""",
"""  type LeadAttributionDto,
  type LeadTouchHistoryDto,""")

# 2) state
patch(P, """  const [attribution, setAttribution] = useState<LeadAttributionDto | null>(null);""",
"""  const [attribution, setAttribution] = useState<LeadAttributionDto | null>(null);
  const [touchHistory, setTouchHistory] = useState<LeadTouchHistoryDto | null>(null);""")

# 3) load 拉取（旁路失败不打扰主数据报错）
patch(P, """      if (attrRes.status === "fulfilled") setAttribution(attrRes.value);""",
"""      if (attrRes.status === "fulfilled") setAttribution(attrRes.value);
      // 触达历史是审计旁路：失败只留 console，不进「部分数据无法读取」告警
      void growthApi
        .getLeadTouchHistory(leadId)
        .then((res) => setTouchHistory(res))
        .catch((reason) => console.error(reason));""")

# 4) 渲染区块：归因链之后、操作反馈之前
patch(P, """      {/* 操作反馈 */}""",
"""      {/* 触达历史（AI 代操作审计：签单→审批→执行全留痕） */}
      <section className="kaypal-v3-panel p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">触达历史</h2>
          {touchHistory?.items.length ? (
            <span className="rounded-md bg-[var(--kaypal-v3-surface-2)] px-2 py-0.5 text-11 text-[var(--kaypal-v3-muted)]">
              {touchHistory.items.length} 条 AI 代操作记录
            </span>
          ) : null}
        </div>
        {!touchHistory || !touchHistory.available || touchHistory.items.length === 0 ? (
          <p className="rounded-lg bg-[var(--kaypal-v3-surface-2)] p-3 text-xs text-[var(--kaypal-v3-muted)]">
            {touchHistory && !touchHistory.available
              ? touchHistory.message ?? "触达历史暂不可用"
              : "暂无 AI 代操作记录。AI 在浏览器面板替你执行的每一步（点击/输入/导航）都会在这里留痕，包含你的批准与拒绝决定"}
          </p>
        ) : (
          <ol className="space-y-2">
            {touchHistory.items.map((t) => {
              const tone =
                t.status === "rejected" || t.decision === "rejected"
                  ? { chip: "danger", label: "已拒绝" }
                  : t.status === "pending"
                    ? { chip: "warning", label: "待你批准" }
                    : t.status === "consumed"
                      ? { chip: "success", label: "已执行" }
                      : t.status === "in_use"
                        ? { chip: "accent", label: "执行中" }
                        : t.decision === "approved"
                          ? { chip: "accent", label: "已批准，待执行" }
                          : { chip: "muted", label: t.status };
              return (
                <li key={t.id} className="flex items-start gap-3 rounded-lg border border-[var(--kaypal-v3-border)] px-3 py-2.5">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${
                      tone.chip === "success"
                        ? "bg-[var(--kaypal-v3-success)]"
                        : tone.chip === "warning"
                          ? "bg-[var(--kaypal-v3-warning)]"
                          : tone.chip === "danger"
                            ? "bg-[var(--kaypal-v3-danger)]"
                            : tone.chip === "accent"
                              ? "bg-[var(--kaypal-v3-primary)]"
                              : "bg-[var(--kaypal-v3-muted)]"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[var(--kaypal-v3-ink)]">
                      {t.label}
                      {t.detail ? (
                        <span className="ml-1 font-normal text-[var(--kaypal-v3-muted)]">
                          {t.detail.length > 42 ? `${t.detail.slice(0, 42)}…` : t.detail}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-11 text-[var(--kaypal-v3-muted)]">
                      {new Date(t.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {t.decidedAt
                        ? ` · ${t.decision === "approved" ? "你批准于" : "你拒绝于"} ${new Date(t.decidedAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                    </p>
                  </div>
                  <span
                    className={`flex-none rounded-md px-2 py-0.5 text-11 font-medium ${
                      tone.chip === "success"
                        ? "border-[var(--kaypal-v3-success-border)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success-ink)]"
                        : tone.chip === "warning"
                          ? "border-[var(--kaypal-v3-warning-border, var(--kaypal-v3-border))] bg-[var(--kaypal-v3-warning-soft, var(--kaypal-v3-surface-2))] text-[var(--kaypal-v3-warning-ink, var(--kaypal-v3-ink))]"
                          : tone.chip === "danger"
                            ? "border-[var(--kaypal-v3-danger-border)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger-ink)]"
                            : tone.chip === "accent"
                              ? "border-[var(--kaypal-v3-primary-border, var(--kaypal-v3-border))] bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-primary)]"
                              : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface-2)] text-[var(--kaypal-v3-muted)]"
                    }`}
                  >
                    {tone.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* 操作反馈 */}""")
print('DETAIL PAGE DONE')
