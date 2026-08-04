"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Textarea,
  V2Select,
  V2PrimaryButton,
  V2GhostButton,
} from "@/components/v2/ui-kit";
import { commitCrmImport, type CrmImportPreviewRow } from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";

type Step = 1 | 2 | 3;

const CRM_FIELDS = [
  { key: "displayName", label: "姓名" },
  { key: "phone", label: "电话" },
  { key: "wechat", label: "微信" },
  { key: "email", label: "邮箱" },
  { key: "companyName", label: "公司" },
  { key: "title", label: "职位" },
];

/** 智能列名猜测 */
function guessField(columnName: string): string {
  const col = columnName.toLowerCase().trim();
  if (/姓名|名字|name(?!.*company)/.test(col)) return "displayName";
  if (/电话|手机|phone|mobile|tel/.test(col)) return "phone";
  if (/微信|wechat|weixin|wx/.test(col)) return "wechat";
  if (/邮箱|邮件|email|mail/.test(col)) return "email";
  if (/公司|企业|company|org/.test(col)) return "companyName";
  if (/职位|职务|title|position/.test(col)) return "title";
  return "";
}

export function CrmImportFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);

  // 第 1 步：粘贴数据 / 上传文件
  const [rawText, setRawText] = useState("");
  const [fileRows, setFileRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [readingFile, setReadingFile] = useState(false);

  // 第 2 步：字段映射
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<CrmImportPreviewRow[]>([]);
  const [loadingPreview] = useState(false);

  // 第 3 步：导入
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [crmNotInstalled, setCrmNotInstalled] = useState(false);

  // 解析粘贴的文本为行
  const parseRows = (text: string): string[][] => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/[\t,，|]/).map((cell) => cell.trim()));
  };

  // 进入字段映射（粘贴和文件两条路共用）
  const goToMapping = (rows: string[][]) => {
    if (rows.length === 0) {
      setError("没有读到有效数据行");
      return;
    }
    setError(null);
    const header = rows[0];
    setColumns(header);
    const autoMapping: Record<string, string> = {};
    header.forEach((col) => {
      const field = guessField(col);
      if (field) autoMapping[col] = field;
    });
    setMapping(autoMapping);
    const dataRows = rows.slice(1, 4).map((cells) => {
      const row: Record<string, string> = {};
      header.forEach((col, i) => {
        row[col] = cells[i] || "";
      });
      return row;
    });
    setPreviewRows(
      dataRows.map((row, i) => ({
        rowNumber: i + 2,
        raw: row,
        normalized: row,
        status: "preview" as const,
        warnings: [],
      })),
    );
    setStep(2);
  };

  const handleNextToMapping = async () => {
    const rows = parseRows(rawText);
    if (rows.length === 0) {
      setError("请先粘贴数据");
      return;
    }
    setFileRows(rows);
    setFileName("粘贴导入");
    goToMapping(rows);
  };

  // 上传 Excel/CSV 文件
  const handleFile = async (file: File) => {
    setReadingFile(true);
    setError(null);
    try {
      let rows: string[][] = [];
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
          header: 1,
          defval: "",
          blankrows: false,
        }).map((r) => r.map((c) => String(c ?? "").trim()));
      } else {
        const text = await file.text();
        rows = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.split(/[\t,，|]/).map((cell) => cell.trim()));
      }
      if (rows.length < 2) {
        setError("文件里至少要有一行表头和一行数据");
        return;
      }
      setFileRows(rows);
      setFileName(file.name);
      goToMapping(rows);
    } catch {
      setError("文件读取失败，请确认是 .xlsx 或 .csv 文件");
    } finally {
      setReadingFile(false);
    }
  };

  // 下载导入模板（本地生成 CSV，Excel 可直接打开编辑）
  const handleDownloadTemplate = () => {
    const header = "姓名/昵称,电话,微信,邮箱,公司,职位,标签";
    const sample = "王女士,13800001111,wxid_abc,wang@example.com,美莱美甲,店长,美甲 高意向";
    const blob = new Blob(["\ufeff" + header + "\n" + sample + "\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "客户导入模板.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    const rows = fileRows ?? parseRows(rawText);
    if (rows.length < 2) {
      setError("至少需要一行表头和一行数据");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const header = rows[0];
      const dataRows = rows.slice(1).map((cells) => {
        const row: Record<string, string> = {};
        header.forEach((col, i) => {
          row[col] = cells[i] || "";
        });
        return row;
      });
      const result = await commitCrmImport({
        filename: fileName || "粘贴导入",
        rows: dataRows,
        mapping,
        hasHeader: true,
        confirmationGate: "MIGO_LOCAL_CRM_IMPORT_APPROVED",
        commit: true,
      });
      setImportResult({
        imported: result.committedCount ?? dataRows.length,
        skipped: (result.rowCount ?? dataRows.length) - (result.committedCount ?? dataRows.length),
      });
      setStep(3);
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "";
      // 未安装 CRM 应用 → 给引导而不是报错
      if (rawMessage.includes("先购买 CRM") || rawMessage.includes("CRM 客户管理应用")) {
        setCrmNotInstalled(true);
        setError(null);
      } else if (rawMessage) {
        // 开发期排障：把后端真实错误带出来（toPublicError 会屏蔽细节）
        setError(`导入失败：${rawMessage}`);
      } else {
        setError(toPublicError(err, "导入失败，请检查后重试"));
      }
    } finally {
      setImporting(false);
    }
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const stepTitles = ["粘贴数据", "确认字段", "完成导入"];

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/crm/import")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              导入客户
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

      {crmNotInstalled && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-5">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
            <div className="flex-1">
              <p className="font-medium text-[var(--kaypal-v3-ink)]">
                需要先安装 CRM 客户管理应用
              </p>
              <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                导入客户是 CRM 应用的功能，安装后就能用了
              </p>
              <div className="mt-3">
                <V2PrimaryButton
                  onClick={() => router.push("/apps/detail?key=crm")}
                >
                  去安装 CRM 应用
                </V2PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 第 1 步：上传文件或粘贴 */}
      {step === 1 && (
        <>
          <V2Section
            title="上传 Excel / CSV 文件"
            description="最快的方式——模板整理好数据，传上来自动识别"
          >
            <div className="flex flex-col gap-4">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--kaypal-v3-radius)] border-2 border-dashed border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper-soft)] p-8 transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)]">
                {readingFile ? (
                  <Loader2 className="h-8 w-8 animate-spin text-[var(--kaypal-v3-accent)]" />
                ) : (
                  <FileSpreadsheet className="h-8 w-8 text-[var(--kaypal-v3-accent)]" />
                )}
                <span className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                  {readingFile ? "正在读取..." : "点击选择 .xlsx / .csv 文件"}
                </span>
                <span className="text-xs text-[var(--kaypal-v3-muted)]">
                  第一行要是列名（姓名、电话、微信…）
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
              <div className="flex justify-center">
                <V2GhostButton icon={Download} onClick={handleDownloadTemplate}>
                  下载导入模板
                </V2GhostButton>
              </div>
            </div>
          </V2Section>

          <V2Section
            title="或者直接粘贴"
            description="从 Excel 复制粘贴过来也行，第一行要是列名"
          >
            <V2Field
              label="客户数据"
              hint="格式示例：第一行是「姓名	电话	微信」，下面每行一个客户，列之间用 Tab 或逗号分隔"
            >
              <V2Textarea
                rows={8}
                placeholder={"姓名\t电话\t微信\n张三\t13800001111\tzhangsan\n李四\t13900002222\tlisi"}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
            </V2Field>
            {rawText.trim() && (
              <p className="mt-2 text-sm text-[var(--kaypal-v3-success)]">
                ✓ 识别到 {parseRows(rawText).length - 1} 行数据
              </p>
            )}
            <div className="mt-6 flex justify-end">
              <V2PrimaryButton
                icon={ArrowRight}
                disabled={!rawText.trim()}
                loading={loadingPreview}
                onClick={handleNextToMapping}
              >
                下一步
              </V2PrimaryButton>
            </div>
          </V2Section>
        </>
      )}

      {/* 第 2 步：映射 */}
      {step === 2 && (
        <V2Section
          title="确认字段对应"
          description={`已自动匹配 ${mappedCount} 列，不对的手动改一下`}
        >
          <div className="grid gap-4">
            {columns.map((col) => (
              <div key={col} className="flex items-center gap-4">
                <div className="w-32">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">{col}</p>
                  <p className="text-xs text-[var(--kaypal-v3-muted)]">表格列名</p>
                </div>
                <span className="text-[var(--kaypal-v3-muted)]">→</span>
                <div className="flex-1">
                  <V2Select
                    value={mapping[col] || ""}
                    onChange={(e) =>
                      setMapping((prev) => ({ ...prev, [col]: e.target.value }))
                    }
                  >
                    <option value="">不导入这一列</option>
                    {CRM_FIELDS.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </V2Select>
                </div>
                {mapping[col] ? (
                  <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-success)]" />
                ) : (
                  <span className="w-5" />
                )}
              </div>
            ))}
          </div>

          {previewRows.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium text-[var(--kaypal-v3-muted)]">
                数据预览（前 {Math.min(previewRows.length, 3)} 行）：
              </p>
              <div className="kaypal-v3-surface overflow-x-auto p-3">
                <pre className="text-xs text-[var(--kaypal-v3-soft-ink)]">
                  {previewRows.slice(0, 3).map((row) => JSON.stringify(row.normalized || row.raw)).join("\n")}
                </pre>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => setStep(1)}>
              上一步
            </V2GhostButton>
            <V2PrimaryButton
              icon={importing ? Loader2 : Upload}
              loading={importing}
              disabled={mappedCount === 0}
              onClick={handleImport}
            >
              {importing ? "正在导入..." : "开始导入"}
            </V2PrimaryButton>
          </div>
        </V2Section>
      )}

      {/* 第 3 步：完成 */}
      {step === 3 && importResult && (
        <V2Section>
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-success-soft)]">
              <FileSpreadsheet className="h-8 w-8 text-[var(--kaypal-v3-success)]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              导入完成
            </h3>
            <div className="mt-4 flex items-center justify-center gap-6">
              <div>
                <p className="text-3xl font-bold text-[var(--kaypal-v3-success)]">
                  {importResult.imported}
                </p>
                <p className="text-sm text-[var(--kaypal-v3-muted)]">成功导入</p>
              </div>
              {importResult.skipped > 0 && (
                <div>
                  <p className="text-3xl font-bold text-[var(--kaypal-v3-amber)]">
                    {importResult.skipped}
                  </p>
                  <p className="text-sm text-[var(--kaypal-v3-muted)]">跳过</p>
                </div>
              )}
            </div>
            <div className="mt-6 flex items-center justify-center gap-3">
              <V2PrimaryButton onClick={() => router.push("/crm")}>
                去看客户
              </V2PrimaryButton>
              <V2GhostButton
                onClick={() => {
                  setStep(1);
                  setRawText("");
                  setMapping({});
                  setImportResult(null);
                }}
              >
                再导一批
              </V2GhostButton>
            </div>
          </div>
        </V2Section>
      )}
    </div>
  );
}
