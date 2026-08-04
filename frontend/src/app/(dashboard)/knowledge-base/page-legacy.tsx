"use client";

import React from "react";
import {
    Button,
    Card,
    CardBody,
    Chip,
    Input,
    Textarea,
    addToast,
} from "@heroui/react";
import { CloudUpload, ExternalLink, FileText, FileUp, HardDrive, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { kaypalApi, type KaypalKnowledgeSearchHit, type LocalKnowledgeItem } from "@/lib/api/auth";
import { toActionableError, toPublicError } from "@/lib/public-error";

function scoreLabel(score: number) {
    if (!Number.isFinite(score)) return "相关度未知";
    return `相关度 ${Math.round(score * 100)}%`;
}

function fileSizeLabel(size: number | null) {
    if (!size || !Number.isFinite(size)) return "文本知识";
    if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function dateTimeLabel(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function isCloudAuthWarning(message: string) {
    return /401|授权.*失效|授权.*过期|请重新登录|未登录|Unauthorized|登录 Kaypal/i.test(message);
}

function isCloudKnowledgePermissionWarning(message: string) {
    return /知识库接口未放行|知识库.*权限|API 权限|登录已生效/i.test(message);
}

function cloudWarningTitle(message: string) {
    if (isCloudKnowledgePermissionWarning(message)) {
        return "本机知识可用，云端权限未开通";
    }
    return "本机知识可用，云端待登录";
}

function cloudAuthWarningDescription(message: string) {
    if (isCloudKnowledgePermissionWarning(message)) {
        return "本机知识可继续使用，但当前账号尚未开通云端知识库同步权限。";
    }
    if (isCloudAuthWarning(message)) {
        return "本机知识已经保留，可继续检索和用于生成；Kaypal 云端授权已失效，重新登录后再同步到团队知识库。";
    }
    return toPublicError(
        message,
        "Kaypal 云端暂时不可用，本机知识仍可使用。",
    );
}

export default function KnowledgeBasePage() {
    const [query, setQuery] = React.useState("");
    const [title, setTitle] = React.useState("");
    const [content, setContent] = React.useState("");
    const [file, setFile] = React.useState<File | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [savingText, setSavingText] = React.useState(false);
    const [uploadingFile, setUploadingFile] = React.useState(false);
    const [syncingId, setSyncingId] = React.useState("");
    const [deletingId, setDeletingId] = React.useState("");
    const [libraryLoading, setLibraryLoading] = React.useState(false);
    const [libraryItems, setLibraryItems] = React.useState<LocalKnowledgeItem[]>([]);
    const [matches, setMatches] = React.useState<KaypalKnowledgeSearchHit[]>([]);
    const [diagnostics, setDiagnostics] = React.useState<string>("");
    const [hasSearched, setHasSearched] = React.useState(false);
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);

    const loadLocalLibrary = React.useCallback(async () =>{
        setLibraryLoading(true);
        try {
            const result = await kaypalApi.listLocalKnowledge();
            setLibraryItems(result.items);
        } catch (error) {
            addToast({
                title: "本机知识库加载失败",
                description: toPublicError(error, "本机知识库暂时无法加载，请重新加载。"),
                color: "danger",
            });
        } finally {
            setLibraryLoading(false);
        }
    }, []);

    React.useEffect(() =>{
        void loadLocalLibrary();
    }, [loadLocalLibrary]);

    async function runSearch(nextQuery?: string) {
        const keyword = (nextQuery ?? query).trim();
        if (!keyword) {
            addToast({ title: "请输入检索内容", color: "warning" });
            return;
        }
        setLoading(true);
        try {
            const result = await kaypalApi.searchKnowledge({ query: keyword, limit: 8 });
            setMatches(result.matches);
            setHasSearched(true);
            setDiagnostics([
                `命中 ${result.total} 条`,
                `本地 ${result.diagnostics?.localHitCount ?? 0} 条`,
                `云端 ${result.diagnostics?.cloudHitCount ?? 0} 条`,
                result.diagnostics?.cloudWarning ? `云端提示：${result.diagnostics.cloudWarning}` : "",
            ].filter(Boolean).join("，"));
        } catch (error) {
            addToast({
                title: "知识库检索失败",
                description: toPublicError(error, "知识库检索未完成，请重试。"),
                color: "danger",
            });
        } finally {
            setLoading(false);
        }
    }

    async function saveTextKnowledge() {
        const body = content.trim();
        if (!body) {
            addToast({ title: "请先填写知识内容", color: "warning" });
            return;
        }
        setSavingText(true);
        try {
            const result = await kaypalApi.createKnowledgeText({
                title: title.trim() || undefined,
                content: body,
            });
            if (result.cloudWarning) {
                addToast({
                    title: cloudWarningTitle(result.cloudWarning),
                    description: cloudAuthWarningDescription(result.cloudWarning),
                    color: "warning",
                });
            } else {
                addToast({
                    title: "知识内容已保存到本机",
                    description: `已保存 ${result.total} 条本地知识，可立即检索和用于生成。`,
                    color: "success",
                });
            }
            setQuery(title.trim() || body.slice(0, 60));
            setTitle("");
            setContent("");
            void loadLocalLibrary();
        } catch (error) {
            addToast({
                title: "知识内容写入失败",
                description: toPublicError(error, "知识内容未保存，请重试。"),
                color: "danger",
            });
        } finally {
            setSavingText(false);
        }
    }

    async function uploadFileKnowledge() {
        if (!file) {
            addToast({ title: "请选择要上传的文件", color: "warning" });
            return;
        }
        const formData = new FormData();
        formData.append("file", file);
        setUploadingFile(true);
        try {
            const result = await kaypalApi.uploadKnowledgeFile(formData);
            addToast({
                title: "文件已保存到本机知识库",
                description: result.parsed === false ? "文件已保存，但未能提取可检索文本。" : `已保存 ${result.total} 条本地知识，可立即检索和用于生成。`,
                color: "success",
            });
            setQuery(file.name.replace(/\.[^.]+$/, ""));
            setFile(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
            void loadLocalLibrary();
        } catch (error) {
            addToast({
                title: "文件上传失败",
                description: toPublicError(error, "文件未上传，请重试。"),
                color: "danger",
            });
        } finally {
            setUploadingFile(false);
        }
    }

    async function syncKnowledge(id: string) {
        setSyncingId(id);
        try {
            const result = await kaypalApi.syncKnowledge(id);
            if (result.cloudWarning || result.ok === false) {
                addToast({
                    title: cloudWarningTitle(result.cloudWarning || ""),
                    description: cloudAuthWarningDescription(result.cloudWarning || ""),
                    color: "warning",
                });
            } else {
                addToast({
                    title: "已同步到 Kaypal 主知识库",
                    description: "主系统会进入索引流程，稍后可被云端知识库检索命中。",
                    color: "success",
                });
            }
            if (query.trim()) void runSearch();
            void loadLocalLibrary();
        } catch (error) {
            const message = toActionableError(error, "");
            if (isCloudAuthWarning(message)) {
                addToast({
                    title: cloudWarningTitle(message),
                    description: cloudAuthWarningDescription(message),
                    color: "warning",
                });
                void loadLocalLibrary();
                return;
            }
            addToast({
                title: "同步云端失败",
                description: toPublicError(error, "云端同步未完成，请重试。"),
                color: "danger",
            });
        } finally {
            setSyncingId("");
        }
    }

    async function deleteKnowledge(id: string) {
        setDeletingId(id);
        try {
            await kaypalApi.deleteLocalKnowledge(id);
            addToast({ title: "已从本机知识库删除", color: "success" });
            setLibraryItems((items) => items.filter((item) => item.id !== id));
            setMatches((items) => items.filter((item) => item.assetId !== id));
        } catch (error) {
            addToast({
                title: "删除失败",
                description: toPublicError(error, "知识内容未删除，请重试。"),
                color: "danger",
            });
        } finally {
            setDeletingId(""); } } return ( <div className="flex flex-col gap-4"> <div className="flex flex-wrap items-start justify-between gap-3"> <div> <h1 className="text-[22px] font-bold leading-[30px]">知识库</h1><p className="text-sm text-default-500">默认先保存到本机，内容生产、互动回复和 AI 员工可立即使用；需要团队共享时再同步到 Kaypal 主知识库。</p>
                </div><Chip color="primary" variant="flat"startContent={<HardDrive size={14} />}> 本地优先 </Chip> </div><div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]"> <Card> <CardBody className="gap-3"> <div> <h2 className="text-base font-semibold">写入文本知识</h2><p className="mt-1 text-sm text-default-500">适合活动政策、产品说明、客服口径、内容选题背景等可直接粘贴的资料。</p>
                        </div><Input
                            label="知识标题"
                            value={title}
                            onValueChange={setTitle}
                            placeholder="例如：6月门店会员活动政策"
                        />
                        <Textarea
                            label="知识内容"
                            value={content}
                            onValueChange={setContent}
                            minRows={6}
                            placeholder="粘贴要保存到本机知识库的内容"
                        />
                        <Button
                            color="primary"startContent={<Save size={16} />} isLoading={savingText} onPress={() => void saveTextKnowledge()} > 保存到本机知识库 </Button> </CardBody> </Card><Card> <CardBody className="gap-3"> <div> <h2 className="text-base font-semibold">上传知识文件</h2><p className="mt-1 text-sm text-default-500">文件会先保存到本机知识库。需要团队共享时，在检索结果里同步到云端。</p> </div><input ref={fileInputRef} className="block w-full rounded-md border border-default-200 bg-white px-3 py-2 text-sm"
                            type="file"onChange={(event) => setFile(event.target.files?.[0] || null)} /> <div className="min-h-6 text-sm text-default-500">{file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : "未选择文件"}</div><Button
                            variant="flat"
                            color="primary"startContent={<FileUp size={16} />} isLoading={uploadingFile} onPress={() => void uploadFileKnowledge()} > 保存到本机知识库 </Button> </CardBody> </Card> </div><Card> <CardBody className="gap-3"> <div> <h2 className="text-base font-semibold">检索验证</h2><p className="mt-1 text-sm text-default-500">默认同时检索本机知识和 Kaypal 主知识库；云端授权失效时，本机知识仍然可用。</p> </div><div className="flex flex-col gap-3 md:flex-row">
                        <Input
                            value={query}
                            onValueChange={setQuery}
                            placeholder="输入客户问题、产品名、活动政策或内容主题"
                            onKeyDown={(event) =>{
                                if (event.key === "Enter") void runSearch();
                            }}
                        />
                        <Button color="primary"startContent={<Search size={16} />} isLoading={loading} onPress={() => void runSearch()}> 检索 </Button> </div>{diagnostics ? <p className="text-xs text-default-500">{diagnostics}</p> : null}</CardBody> </Card><Card> <CardBody className="gap-4"> <div className="flex flex-wrap items-start justify-between gap-3"> <div> <h2 className="text-base font-semibold">本机知识库</h2><p className="mt-1 text-sm text-default-500">这里才是已经保存到电脑里的知识。内容生产、互动回复和 AI 员工会先从这里取可用资料。</p>
                        </div><Button
                            size="sm"
                            variant="flat"startContent={<RefreshCw size={14} />} isLoading={libraryLoading} onPress={() => void loadLocalLibrary()} > 刷新 </Button> </div>{libraryItems.length > 0 ? ( <div className="grid gap-3">{libraryItems.map((item) => ( <div key={item.id} className="rounded-lg border border-default-200 bg-white p-4"> <div className="flex flex-wrap items-start justify-between gap-3"> <div className="min-w-0 flex-1"> <div className="flex flex-wrap items-center gap-2"> <FileText size={16} className="text-default-500"/> <h3 className="break-words text-sm font-semibold text-default-900">{item.title}</h3><Chip size="sm" variant="flat" color={item.parsed ? "success" : "warning"}>{item.parsed ? "已解析" : "未解析"}</Chip><Chip size="sm" variant="flat" color={item.syncStatus === "synced" ? "success" : "default"}>{item.syncStatus === "synced" ? "已同步" : "本机"}</Chip> </div><p className="mt-2 text-xs text-default-500">{item.fileName || "文本写入"} · {fileSizeLabel(item.fileSize)} · 更新 {dateTimeLabel(item.updatedAt)}</p><p className="mt-2 line-clamp-2 text-sm leading-6 text-default-700">{item.summary || "暂无摘要"}</p> </div><div className="flex shrink-0 gap-2">
                                            <Button
                                                size="sm"
                                                variant="flat"
                                                color="primary"
                                                startContent={<Search size={14} />}
                                                onPress={() =>{
                                                    setQuery(item.title);
                                                    void runSearch(item.title);
                                                }}
                                            >
                                                检索
                                            </Button><Button
                                                size="sm"
                                                variant="flat"
                                                color="primary"
                                                startContent={<CloudUpload size={14} />}
                                                isLoading={syncingId === item.id}
                                                onPress={() => void syncKnowledge(item.id)}
                                            >
                                                同步
                                            </Button><Button
                                                size="sm"
                                                variant="flat"
                                                color="danger"startContent={<Trash2 size={14} />} isLoading={deletingId === item.id} onPress={() => void deleteKnowledge(item.id)} > 删除 </Button> </div> </div> </div> ))}</div> ) : ( <div className="rounded-lg border border-dashed border-default-300 py-10 text-center text-sm text-default-500">{libraryLoading ? "正在加载本机知识库..." : "本机知识库还没有内容。上传文件或写入文本后，会显示在这里。"}</div> )}</CardBody> </Card><div className="grid gap-3">{matches.map((item) => (
                    <Card key={`${item.assetId}-${item.chunkId || "asset"}`}> <CardBody className="gap-2"> <div className="flex flex-wrap items-start justify-between gap-2"> <div> <h2 className="text-base font-semibold">{item.title}</h2><p className="text-xs text-default-500">{item.sourceType === "local" ? "本机知识" : "云端知识"} · {scoreLabel(item.relevanceScore)} · {item.syncStatus || item.rankingReason}</p>
                                </div>{item.sourceType === "local" ? (
                                    <Button
                                        size="sm"
                                        variant="flat"
                                        color="primary"
                                        startContent={<CloudUpload size={14} />}
                                        isLoading={syncingId === item.assetId}
                                        onPress={() => void syncKnowledge(item.assetId)}
                                    >
                                        同步云端
                                    </Button>
                                ) : item.sourceUrl ? (
                                    <Button as="a" href={item.sourceUrl} target="_blank" rel="noreferrer" size="sm" variant="flat"startContent={<ExternalLink size={14} />}> 来源 </Button> ) : null}</div><p className="text-sm leading-6 text-default-700">{item.snippet}</p> </CardBody> </Card> ))} {!loading && hasSearched && query.trim() && matches.length === 0 ? ( <Card> <CardBody className="py-10 text-center text-sm text-default-500">没有命中本机或 Kaypal 主知识库内容。</CardBody>
                    </Card>
                ) : null}</div>
        </div>
    );
}
