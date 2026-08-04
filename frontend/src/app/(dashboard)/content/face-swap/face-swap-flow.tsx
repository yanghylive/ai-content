"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Upload,
  UserRound,
  Wand2,
} from "lucide-react";
import {
  V2Section,
  V2PrimaryButton,
  V2GhostButton,
  V2StatusChip,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import { videoFaceSwapApi, type VideoFaceSwapMaterialFile } from "@/lib/api/video-face-swap";
import { toPublicError } from "@/lib/public-error";

type Step = 1 | 2 | 3;

type MaterialFile = VideoFaceSwapMaterialFile;

export function FaceSwapFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);

  // 第 1 步：照片
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 第 2 步：模板
  const [templates, setTemplates] = useState<MaterialFile[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<MaterialFile | null>(null);

  // 第 3 步：生成
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      setLoadingTemplates(true);
      const data = await videoFaceSwapApi.materialFiles(50);
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      // 模板加载失败不阻断，显示空态
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const handlePhotoSelect = async (file: File | null) => {
    if (!file) return;
    setPhotoFile(file);
    setError(null);
    setPhotoPreview(URL.createObjectURL(file));

    // 立即上传
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await videoFaceSwapApi.uploadMaterialFile(formData);
      setPhotoPath(result.path);
    } catch (err: unknown) {
      setError(toPublicError(err, "照片上传失败，请重试"));
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!photoPath || !selectedTemplate) return;
    setGenerating(true);
    setError(null);
    try {
      await videoFaceSwapApi.createJob({
        mode: "face_swap",
        targetPath: selectedTemplate.path,
        sourcePath: photoPath,
        outputName: `换脸_${Date.now()}`,
      });
      setDone(true);
    } catch (err: unknown) {
      setError(toPublicError(err, "生成失败，请稍后重试"));
    } finally {
      setGenerating(false);
    }
  };

  const stepTitles = ["上传照片", "选模板", "生成"];

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/content/face-swap")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              换脸创作
            </h1>
            <div className="mt-3 flex items-center gap-2">
              {stepTitles.map((title, index) => {
                const num = (index + 1) as Step;
                return (
                  <div key={title} className="flex items-center gap-2">
                    {index > 0 && (
                      <div className="h-px w-6 bg-[var(--kaypal-v3-border-strong)]" />
                    )}
                    <div
                      className={`flex items-center gap-1.5 text-sm ${
                        step >= num
                          ? "font-medium text-[var(--kaypal-v3-accent-ink)]"
                          : "text-[var(--kaypal-v3-muted)]"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                          step >= num
                            ? "bg-[var(--kaypal-v3-accent)] text-white"
                            : "bg-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-muted)]"
                        }`}
                      >
                        {step > num ? "✓" : num}
                      </span>
                      {title}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 第 1 步：上传照片 */}
      {step === 1 && (
        <V2Section title="上传一张清晰的人脸照片" description="正面、光线好的照片效果最好">
          {!photoPreview ? (
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--kaypal-v3-radius)] border-2 border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-12 transition hover:border-[var(--kaypal-v3-accent)]">
              <Upload className="h-10 w-10 text-[var(--kaypal-v3-muted)]" />
              <p className="mt-4 font-medium text-[var(--kaypal-v3-ink)]">
                点击选择照片
              </p>
              <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                支持 JPG / PNG，建议正面清晰照
              </p>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePhotoSelect(e.target.files?.[0] || null)}
              />
            </label>
          ) : (
            <div className="flex items-start gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview}
                alt="人脸照片"
                className="h-40 w-40 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] object-cover"
              />
              <div className="flex-1">
                <V2StatusChip tone={uploading ? "warning" : photoPath ? "success" : "muted"}>
                  {uploading ? "上传中..." : photoPath ? "已上传" : "待上传"}
                </V2StatusChip>
                <p className="mt-3 text-sm text-[var(--kaypal-v3-muted)]">
                  {photoFile?.name}
                </p>
                <button
                  type="button"
                  className="mt-2 text-sm text-[var(--kaypal-v3-accent-ink)] hover:underline"
                  onClick={() => {
                    setPhotoFile(null);
                    setPhotoPreview(null);
                    setPhotoPath(null);
                  }}
                >
                  换一张
                </button>
              </div>
            </div>
          )}
          <div className="mt-6 flex justify-end">
            <V2PrimaryButton
              icon={ArrowRight}
              disabled={!photoPath || uploading}
              onClick={() => setStep(2)}
            >
              下一步
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}

      {/* 第 2 步：选模板 */}
      {step === 2 && (
        <V2Section title="选一个换脸模板" description="你的脸会替换到选中的模板里">
          {loadingTemplates ? (
            <div className="p-8 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
            </div>
          ) : templates.length === 0 ? (
            <V2EmptyState
              icon={ImageIcon}
              title="还没有可用模板"
              description="模板由系统提供，稍后再试"
            />
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`relative overflow-hidden rounded-[var(--kaypal-v3-radius)] border-2 transition ${
                    selectedTemplate?.id === template.id
                      ? "border-[var(--kaypal-v3-accent)]"
                      : "border-transparent hover:border-[var(--kaypal-v3-border-strong)]"
                  }`}
                  onClick={() => setSelectedTemplate(template)}
                >
                  {template.path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={videoFaceSwapApi.previewUrl(template.path)}
                      alt={template.name}
                      className="aspect-video w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center bg-[var(--kaypal-v3-paper-soft)]">
                      <UserRound className="h-8 w-8 text-[var(--kaypal-v3-muted)]" />
                    </div>
                  )}
                  {selectedTemplate?.id === template.id && (
                    <div className="absolute right-2 top-2 rounded-full bg-[var(--kaypal-v3-accent)] p-1">
                      <CheckCircle2 className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <p className="truncate p-2 text-xs text-[var(--kaypal-v3-soft-ink)]">
                    {template.name}
                  </p>
                </button>
              ))}
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => setStep(1)}>
              上一步
            </V2GhostButton>
            <V2PrimaryButton
              icon={ArrowRight}
              disabled={!selectedTemplate}
              onClick={() => setStep(3)}
            >
              下一步
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}

      {/* 第 3 步：确认生成 */}
      {step === 3 && !done && (
        <V2Section title="确认并开始生成">
          <div className="flex items-start gap-6">
            <div className="flex items-center gap-3">
              {photoPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoPreview}
                  alt="照片"
                  className="h-24 w-24 rounded-[var(--kaypal-v3-radius)] border object-cover"
                />
              )}
              <span className="text-2xl text-[var(--kaypal-v3-muted)]">+</span>
              {selectedTemplate?.path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={videoFaceSwapApi.previewUrl(selectedTemplate.path)}
                  alt="模板"
                  className="h-24 w-32 rounded-[var(--kaypal-v3-radius)] border object-cover"
                />
              )}
            </div>
          </div>
          <div className="mt-6 flex justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => setStep(2)}>
              上一步
            </V2GhostButton>
            <V2PrimaryButton
              icon={generating ? Loader2 : Wand2}
              loading={generating}
              onClick={handleGenerate}
            >
              {generating ? "正在生成..." : "开始生成"}
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}

      {/* 完成态 */}
      {done && (
        <V2Section>
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-success-soft)]">
              <CheckCircle2 className="h-8 w-8 text-[var(--kaypal-v3-success)]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              生成任务已提交
            </h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              AI 正在处理，完成后可以在创作记录里下载
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <V2PrimaryButton onClick={() => router.push("/content/face-swap?filter=done")}>
                去查看作品
              </V2PrimaryButton>
              <V2GhostButton
                onClick={() => {
                  setStep(1);
                  setPhotoFile(null);
                  setPhotoPreview(null);
                  setPhotoPath(null);
                  setSelectedTemplate(null);
                  setDone(false);
                }}
              >
                再做一张
              </V2GhostButton>
            </div>
          </div>
        </V2Section>
      )}
    </div>
  );
}
