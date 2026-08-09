import assert from "node:assert/strict";
import test from "node:test";
import {
  canEnterWorkspaceStep,
  contentWorkspaceReducer,
  createInitialWorkspaceState,
  loadRequestedOrFirstDocument,
  resolveWorkspaceStep,
} from "../src/app/(dashboard)/content/workspace/content-workspace-state.ts";

const emptyValue = () => ({
  title: "标题",
  brief: {
    goal: "",
    audience: "",
    platforms: [],
    deadline: null,
    action: "",
    constraints: "",
  },
  outline: { items: [], confirmedAt: null, confirmedItemsHash: null },
  content: "正文",
  legacyBodyEditable: false,
});

test("URL step wins over a persisted step and missing URL restores persistence", () => {
  assert.equal(resolveWorkspaceStep("draft", "outline"), "draft");
  assert.equal(resolveWorkspaceStep(null, "outline"), "outline");
});

test("an explicitly invalid URL step returns to the safe brief step", () => {
  assert.equal(resolveWorkspaceStep("unknown", "review"), "brief");
  assert.equal(resolveWorkspaceStep(null, "unknown"), "brief");
});

test("the reducer hydrates and transitions workspace steps", () => {
  const initial = createInitialWorkspaceState(emptyValue());
  const hydrated = contentWorkspaceReducer(initial, {
    type: "hydrate",
    value: {
      ...emptyValue(),
      title: "已保存标题",
      legacyBodyEditable: true,
    },
    step: "outline",
  });
  assert.equal(hydrated.activeStep, "outline");
  assert.equal(hydrated.value.title, "已保存标题");
  assert.equal(
    contentWorkspaceReducer(hydrated, { type: "set_step", step: "draft" })
      .activeStep,
    "draft",
  );
});

test("a new empty draft cannot bypass outline confirmation", () => {
  const initial = createInitialWorkspaceState({
    ...emptyValue(),
    content: "",
  });
  const outline = contentWorkspaceReducer(initial, {
    type: "set_step",
    step: "outline",
  });
  const blocked = contentWorkspaceReducer(outline, {
    type: "set_step",
    step: "draft",
  });
  assert.equal(blocked.activeStep, "outline");
  assert.equal(canEnterWorkspaceStep(blocked.value, "draft"), false);

  const confirmed = contentWorkspaceReducer(blocked, {
    type: "hydrate",
    step: "outline",
    value: {
      ...blocked.value,
      outline: {
        items: [{ id: "intro", title: "开场", summary: "" }],
        confirmedAt: "2026-07-22T08:00:00.000Z",
        confirmedItemsHash: "a".repeat(64),
      },
    },
  });
  assert.equal(
    contentWorkspaceReducer(confirmed, { type: "set_step", step: "draft" })
      .activeStep,
    "draft",
  );
  assert.equal(
    canEnterWorkspaceStep(
      {
        ...confirmed.value,
        outline: { ...confirmed.value.outline, confirmedItemsHash: "fake" },
      },
      "draft",
    ),
    false,
  );
});

test("legacy compatibility is explicit and only permits the draft step", () => {
  const state = createInitialWorkspaceState({
    ...emptyValue(),
    legacyBodyEditable: true,
  });
  assert.equal(canEnterWorkspaceStep(state.value, "draft"), true);
  assert.equal(canEnterWorkspaceStep(state.value, "versions"), false);
  assert.equal(canEnterWorkspaceStep(state.value, "review"), false);
  assert.equal(
    canEnterWorkspaceStep({ ...state.value, legacyBodyEditable: false }, "draft"),
    false,
  );
});

test("a deep-linked article is loaded directly even outside the queue page", async () => {
  const calls = [];
  const loaded = await loadRequestedOrFirstDocument(
    "article-61",
    [{ id: "article-1" }],
    async (id) => {
      calls.push(id);
      return id === "article-61";
    },
  );
  assert.equal(loaded, "article-61");
  assert.deepEqual(calls, ["article-61"]);
});

test("an invalid deep link reports failure before using the first queue item", async () => {
  const calls = [];
  const loaded = await loadRequestedOrFirstDocument(
    "missing",
    [{ id: "article-1" }],
    async (id) => {
      calls.push(id);
      return id === "article-1";
    },
  );
  assert.equal(loaded, "article-1");
  assert.deepEqual(calls, ["missing", "article-1"]);
});

test("brief, outline, and body change independently", () => {
  let state = createInitialWorkspaceState(emptyValue());
  state = contentWorkspaceReducer(state, {
    type: "update_brief",
    patch: { audience: "门店负责人" },
  });
  state = contentWorkspaceReducer(state, {
    type: "add_outline_item",
    item: { id: "one", title: "开场", summary: "先说结论" },
  });
  assert.equal(state.value.brief.audience, "门店负责人");
  assert.equal(state.value.outline.items[0].title, "开场");
  assert.equal(state.value.content, "正文");
});

test("outline edits and moves clear the previous confirmation", () => {
  let state = createInitialWorkspaceState({
    ...emptyValue(),
    outline: {
      items: [
        { id: "one", title: "第一", summary: "" },
        { id: "two", title: "第二", summary: "" },
      ],
      confirmedAt: "2026-07-22T08:00:00.000Z",
      confirmedItemsHash: "b".repeat(64),
    },
    legacyBodyEditable: true,
  });
  assert.equal(state.value.outline.confirmedAt, "2026-07-22T08:00:00.000Z");
  state = contentWorkspaceReducer(state, {
    type: "move_outline_item",
    id: "two",
    direction: -1,
  });
  assert.deepEqual(
    state.value.outline.items.map((item) => item.id),
    ["two", "one"],
  );
  assert.equal(state.value.outline.confirmedAt, null);
  assert.equal(state.value.outline.confirmedItemsHash, null);
  assert.equal(state.value.legacyBodyEditable, false);
  assert.equal(canEnterWorkspaceStep(state.value, "draft"), false);
});
