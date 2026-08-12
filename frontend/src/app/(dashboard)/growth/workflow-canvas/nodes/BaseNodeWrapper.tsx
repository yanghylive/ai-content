import { memo, type ReactNode } from "react";
import { Handle, Position } from "reactflow";

interface BaseNodeWrapperProps {
  label: string;
  icon: ReactNode;
  accentColor?: string;
  statusColor?: string;
  children?: ReactNode;
}

function BaseNodeWrapper({
  label,
  icon,
  accentColor = "#6366f1",
  statusColor,
  children,
}: BaseNodeWrapperProps) {
  return (
    <div
      className="min-w-[170px] rounded-[var(--kaypal-v3-radius-sm)] border-2 bg-[var(--kaypal-v3-paper)] shadow-sm"
      style={{ borderColor: statusColor ?? "var(--kaypal-v3-border)" }}
    >
      <Handle
        type="target"
        id="in"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-white !bg-[var(--kaypal-v3-accent)]"
      />
      <div
        className="flex items-center gap-2 rounded-t-[calc(var(--kaypal-v3-radius-sm)-2px)] px-3 py-2 text-sm font-semibold text-white"
        style={{ backgroundColor: accentColor }}
      >
        <span className="flex items-center">{icon}</span>
        <span className="truncate">{label}</span>
        {statusColor && (
          <span
            className="ml-auto h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor === "#10b981" ? "#d1fae5" : "#fff" }}
            title={statusColor === "#10b981" ? "已完成" : statusColor === "#3b82f6" ? "执行中" : "失败"}
          />
        )}
      </div>
      {children && (
        <div className="border-t border-[var(--kaypal-v3-border)] px-3 py-2 text-xs text-[var(--kaypal-v3-muted)]">
          {children}
        </div>
      )}
      <Handle
        type="source"
        id="out"
        position={Position.Bottom}
        className="!h-3 !w-3 !border-2 !border-white !bg-[var(--kaypal-v3-accent)]"
      />
    </div>
  );
}

export default memo(BaseNodeWrapper);
