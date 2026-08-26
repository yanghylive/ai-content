"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { toActionableError } from "@/lib/public-error";

type Job = {
  id: string;
  name: string;
  storeName: string;
  sceneUrl: string;
  status: string;
  replyMode: string;
  segments: Array<{ id: string; text: string; audioReady: boolean }>;
  lastError?: string;
};

type Health = {
  workerConfigured: boolean;
  workerMode: string;
  replyMode: string;
  persistence: string;
};

const statusLabel: Record<string, string> = {
  DRAFT: "草稿",
  STARTING: "启动中",
  LIVE: "直播中",
  DEGRADED: "受限",
  PAUSED: "已暂停",
  ENDED: "已结束",
  FAILED: "失败",
};

export default function BroadcastPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [sceneUrl, setSceneUrl] = useState("");
  const [segmentText, setSegmentText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [nextJobs, nextHealth] = await Promise.all([
        api.get<Job[]>("/broadcast/jobs"),
        api.get<Health>("/broadcast/health"),
      ]);
      setJobs(nextJobs);
      setHealth(nextHealth);
    } catch (cause) {
      setError(toActionableError(cause, "直播服务不可用"));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const createJob = async () => {
    setBusy(true);
    setError(null);
    try {
      const job = await api.post<Job>("/broadcast/jobs", {
        name,
        storeName,
        sceneUrl,
      });
      setJobs((items) => [job, ...items]);
      setSelected(job.id);
      setName("");
      setStoreName("");
      setSceneUrl("");
    } catch (cause) {
      setError("创建失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const action = async (id: string, verb: "start" | "pause" | "stop") => {
    setBusy(true);
    setError(null);
    try {
      const job = await api.post<Job>(`/broadcast/jobs/${id}/${verb}`, {});
      setJobs((items) => items.map((item) => (item.id === id ? job : item)));
    } catch (cause) {
      setError("操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const addSegment = async () => {
    if (!selected || !segmentText.trim()) return;
    setBusy(true);
    try {
      const job = await api.post<Job>(`/broadcast/jobs/${selected}/segments`, {
        text: segmentText,
      });
      setJobs((items) => items.map((item) => (item.id === selected ? job : item)));
      setSegmentText("");
    } catch (cause) {
      setError("添加语音片段失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-default-500">Broadcast Control Plane</p>
          <h1 className="mt-2 text-2xl font-semibold">实景无人直播</h1>
          <p className="mt-1 text-sm text-default-500">真实场景 + AI 语音 + 手机可控。留言模式默认为只读观察。</p>
        </div>
        <div className="rounded-large border border-default-200 bg-content1 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${health?.workerConfigured ? "bg-success" : "bg-warning"}`} />
            <span>{health?.workerConfigured ? "推流 Worker 已配置" : "推流 Worker 未配置"}</span>
          </div>
          <div className="mt-1 text-xs text-default-500">持久化：{health?.persistence ?? "检查中"} · 回复：只读观察</div>
        </div>
      </header>

      {error ? <div className="rounded-medium border border-danger-200 bg-danger-50 p-3 text-sm text-danger">{error}</div> : null}

      <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="rounded-large border border-default-200 bg-content1 p-5">
          <h2 className="text-base font-semibold">创建直播任务</h2>
          <div className="mt-4 space-y-3">
            <input className="w-full rounded-medium border border-default-200 bg-content2 px-3 py-2 text-sm" placeholder="任务名称" value={name} onChange={(event) => setName(event.target.value)} />
            <input className="w-full rounded-medium border border-default-200 bg-content2 px-3 py-2 text-sm" placeholder="门店名称" value={storeName} onChange={(event) => setStoreName(event.target.value)} />
            <input className="w-full rounded-medium border border-default-200 bg-content2 px-3 py-2 text-sm" placeholder="实景视频 URL 或素材地址" value={sceneUrl} onChange={(event) => setSceneUrl(event.target.value)} />
            <button type="button" disabled={busy || !name || !storeName || !sceneUrl} onClick={() => void createJob()} className="w-full rounded-medium bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">创建任务</button>
          </div>
          <div className="mt-5 rounded-medium bg-warning-50 p-3 text-xs text-warning-700">当前版本会真实校验控制平面和 TTS，但未配置 FFmpeg Worker 时不会伪装为已开播。</div>
        </div>

        <div className="space-y-4">
          {jobs.length === 0 ? <div className="rounded-large border border-dashed border-default-300 p-10 text-center text-sm text-default-500">暂无直播任务</div> : jobs.map((job) => (
            <article key={job.id} className={`rounded-large border bg-content1 p-5 ${selected === job.id ? "border-primary" : "border-default-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button type="button" className="text-left" onClick={() => setSelected(job.id)}>
                  <h2 className="font-semibold">{job.name}</h2>
                  <p className="mt-1 text-xs text-default-500">{job.storeName} · {job.sceneUrl}</p>
                </button>
                <span className="rounded-full bg-default-100 px-3 py-1 text-xs">{statusLabel[job.status] ?? job.status}</span>
              </div>
              {job.lastError ? <p className="mt-3 rounded-medium bg-warning-50 p-2 text-xs text-warning-700">{job.lastError}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void action(job.id, "start")} className="rounded-medium bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">启动</button>
                <button type="button" disabled={busy} onClick={() => void action(job.id, "pause")} className="rounded-medium border border-default-200 px-3 py-1.5 text-xs disabled:opacity-50">暂停</button>
                <button type="button" disabled={busy} onClick={() => void action(job.id, "stop")} className="rounded-medium border border-danger-200 px-3 py-1.5 text-xs text-danger disabled:opacity-50">结束</button>
              </div>
              {selected === job.id ? <div className="mt-4 border-t border-default-100 pt-4">
                <div className="flex gap-2">
                  <input className="min-w-0 flex-1 rounded-medium border border-default-200 bg-content2 px-3 py-2 text-sm" placeholder="添加 AI 语音口播片段" value={segmentText} onChange={(event) => setSegmentText(event.target.value)} />
                  <button type="button" disabled={busy || !segmentText.trim()} onClick={() => void addSegment()} className="rounded-medium border border-default-200 px-3 py-2 text-xs disabled:opacity-50">添加</button>
                </div>
                <div className="mt-3 space-y-2">
                  {job.segments.length === 0 ? <p className="text-xs text-default-500">还没有语音片段</p> : job.segments.map((segment) => <div key={segment.id} className="flex items-center justify-between gap-3 rounded-medium bg-content2 px-3 py-2 text-xs"><span className="truncate">{segment.text}</span><span className={segment.audioReady ? "text-success" : "text-default-500"}>{segment.audioReady ? "已生成" : "待生成"}</span></div>)}
                </div>
              </div> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
