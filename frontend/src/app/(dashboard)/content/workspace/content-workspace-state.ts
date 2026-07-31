import type {
  EditorValue,
  WorkspaceStepId,
} from "./workspace-types";
import type {
  ContentWorkspaceBrief,
  ContentWorkspaceOutlineItem,
} from "@/lib/content-workspace-types";

export type ContentWorkspaceState = {
  activeStep: WorkspaceStepId;
  value: EditorValue;
};

export type ContentWorkspaceAction =
  | { type: "hydrate"; value: EditorValue; step: unknown }
  | { type: "replace_value"; value: EditorValue }
  | { type: "set_step"; step: unknown }
  | { type: "update_brief"; patch: Partial<ContentWorkspaceBrief> }
  | { type: "add_outline_item"; item: ContentWorkspaceOutlineItem }
  | {
      type: "update_outline_item";
      id: string;
      patch: Partial<Pick<ContentWorkspaceOutlineItem, "title" | "summary">>;
    }
  | { type: "remove_outline_item"; id: string }
  | { type: "move_outline_item"; id: string; direction: -1 | 1 };

const WORKSPACE_STEP_IDS: readonly WorkspaceStepId[] = [
  "brief",
  "outline",
  "draft",
  "versions",
  "review",
];

export function isWorkspaceStep(value: unknown): value is WorkspaceStepId {
  return (
    typeof value === "string" &&
    WORKSPACE_STEP_IDS.includes(value as WorkspaceStepId)
  );
}

export function resolveWorkspaceStep(
  urlStep: string | null,
  persistedStep: unknown,
): WorkspaceStepId {
  if (urlStep !== null) return isWorkspaceStep(urlStep) ? urlStep : "brief";
  return isWorkspaceStep(persistedStep) ? persistedStep : "brief";
}

export function canEnterWorkspaceStep(
  value: EditorValue,
  step: WorkspaceStepId,
) {
  const targetIndex = WORKSPACE_STEP_IDS.indexOf(step);
  if (targetIndex <= WORKSPACE_STEP_IDS.indexOf("outline")) return true;
  if (
    value.outline.items.length > 0 &&
    value.outline.items.every((item) => item.title.trim()) &&
    value.outline.confirmedAt &&
    !Number.isNaN(Date.parse(value.outline.confirmedAt)) &&
    /^[a-f0-9]{64}$/.test(value.outline.confirmedItemsHash || "")
  ) {
    return true;
  }
  return step === "draft" && value.legacyBodyEditable;
}

export function constrainWorkspaceStep(
  value: EditorValue,
  step: unknown,
): WorkspaceStepId {
  const safeStep = isWorkspaceStep(step) ? step : "brief";
  return canEnterWorkspaceStep(value, safeStep) ? safeStep : "outline";
}

export async function loadRequestedOrFirstDocument(
  requestedId: string | null,
  items: ReadonlyArray<{ id: string }>,
  loadDocument: (id: string) => Promise<boolean>,
) {
  const requested = requestedId?.trim() || "";
  if (requested && (await loadDocument(requested))) return requested;

  const fallback = items[0]?.id || "";
  if (fallback && fallback !== requested && (await loadDocument(fallback))) {
    return fallback;
  }
  return null;
}

export function createInitialWorkspaceState(value: EditorValue): ContentWorkspaceState {
  return { activeStep: "brief", value };
}

export function contentWorkspaceReducer(
  state: ContentWorkspaceState,
  action: ContentWorkspaceAction,
): ContentWorkspaceState {
  switch (action.type) {
    case "hydrate":
      return {
        activeStep: constrainWorkspaceStep(action.value, action.step),
        value: action.value,
      };
    case "replace_value":
      return { ...state, value: action.value };
    case "set_step":
      return {
        ...state,
        activeStep: constrainWorkspaceStep(state.value, action.step),
      };
    case "update_brief":
      return {
        ...state,
        value: {
          ...state.value,
          brief: { ...state.value.brief, ...action.patch },
        },
      };
    case "add_outline_item":
      return withOutlineItems(state, [
        ...state.value.outline.items,
        action.item,
      ]);
    case "update_outline_item":
      return withOutlineItems(
        state,
        state.value.outline.items.map((item) =>
          item.id === action.id ? { ...item, ...action.patch } : item,
        ),
      );
    case "remove_outline_item":
      return withOutlineItems(
        state,
        state.value.outline.items.filter((item) => item.id !== action.id),
      );
    case "move_outline_item": {
      const items = [...state.value.outline.items];
      const from = items.findIndex((item) => item.id === action.id);
      const to = from + action.direction;
      if (from < 0 || to < 0 || to >= items.length) return state;
      [items[from], items[to]] = [items[to], items[from]];
      return withOutlineItems(state, items);
    }
  }
}

function withOutlineItems(
  state: ContentWorkspaceState,
  items: ContentWorkspaceOutlineItem[],
): ContentWorkspaceState {
  return {
    ...state,
    value: {
      ...state.value,
      outline: { items, confirmedAt: null, confirmedItemsHash: null },
      legacyBodyEditable: false,
    },
  };
}
