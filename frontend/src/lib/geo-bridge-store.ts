import { promises as fs } from "fs";
import path from "path";
import type { GeoBridgeTask, GeoBridgeStatus } from "./geo-bridge";

const STORE_PATH = path.join(process.cwd(), ".local-geo-bridge-tasks.json");
const MAX_TASKS = 200;

async function readTasks(): Promise<GeoBridgeTask[]> {
    try {
        const raw = await fs.readFile(STORE_PATH, "utf8");
        const tasks = JSON.parse(raw) as GeoBridgeTask[];
        return Array.isArray(tasks) ? tasks : [];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
}

async function writeTasks(tasks: GeoBridgeTask[]) {
    const sortedTasks = tasks
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, MAX_TASKS);
    await fs.writeFile(STORE_PATH, JSON.stringify(sortedTasks, null, 2), "utf8");
    return sortedTasks;
}

export async function listStoredGeoBridgeTasks(limit = 50) {
    const tasks = await readTasks();
    return tasks
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);
}

export async function upsertStoredGeoBridgeTask(
    input: Omit<GeoBridgeTask, "id" | "receivedAt" | "updatedAt"> & {
        id?: string;
        receivedAt?: string;
        updatedAt?: string;
    },
) {
    const tasks = await readTasks();
    const now = new Date().toISOString();
    const existing = tasks.find((task) => task.actionId === input.actionId);
    const nextTask: GeoBridgeTask = {
        ...(existing || {}),
        ...input,
        id: existing?.id || input.id || `geo-task-${Date.now()}`,
        receivedAt: existing?.receivedAt || input.receivedAt || now,
        updatedAt: now,
    };

    await writeTasks([nextTask, ...tasks.filter((task) => task.actionId !== input.actionId)]);
    return nextTask;
}

export async function patchStoredGeoBridgeTask(
    actionId: string,
    patch: Partial<Pick<GeoBridgeTask, "resultUrl" | "publishedUrl" | "lastCallbackAt">> & {
        status?: GeoBridgeStatus;
    },
) {
    const tasks = await readTasks();
    const existing = tasks.find((task) => task.actionId === actionId);
    if (!existing) return null;

    const nextTask: GeoBridgeTask = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    await writeTasks([nextTask, ...tasks.filter((task) => task.actionId !== actionId)]);
    return nextTask;
}
