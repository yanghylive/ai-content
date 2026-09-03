import { NODE_TYPE_META, type GrowthCanvasNodeType } from "./nodeTypes";

const NODE_TYPES: GrowthCanvasNodeType[] = [
  "strategy",
  "content",
  "publish",
  "acquisition",
  "follow-up",
  "crm",
  "report",
];

function onDragStart(event: React.DragEvent, nodeType: GrowthCanvasNodeType) {
  event.dataTransfer.setData(
    "application/reactflow",
    JSON.stringify({ type: nodeType, label: NODE_TYPE_META[nodeType].label }),
  );
  event.dataTransfer.effectAllowed = "move";
}

export default function NodePanel() {
  return (
    <div className="flex w-44 flex-col gap-1 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-2 shadow-sm">
      <div className="rounded bg-[image:var(--kaypal-v3-gradient-primary)] px-2 py-1.5 text-xs font-semibold text-white">
        拖拽节点到画布
      </div>
      {NODE_TYPES.map((type) => {
        const meta = NODE_TYPE_META[type];
        const Icon = meta.icon;
        return (
          <div
            key={type}
            draggable
            onDragStart={(e) => onDragStart(e, type)}
            className="flex cursor-grab items-center gap-2 rounded border border-[var(--kaypal-v3-border)] px-3 py-2 text-sm text-[var(--kaypal-v3-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-sm active:cursor-grabbing"
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white"
              style={{ backgroundColor: meta.accent }}
            >
              <Icon className="h-3 w-3" />
            </span>
            {meta.label}
          </div>
        );
      })}
    </div>
  );
}
