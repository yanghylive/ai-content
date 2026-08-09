export function Header() {
  return (
    <div className="px-4 py-3 border-b flex items-center gap-2 bg-accent/10">
      <div className="inline-flex items-center justify-center rounded-full border border-accent/40 bg-card size-8 p-2">
        <span className="text-lg p-2">K</span>
      </div>
      <span className="text-base font-medium text-foreground">
        JIUZHANG AI Agent 操作驾驶台
      </span>
    </div>
  );
}
