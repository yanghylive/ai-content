import { api } from "@/lib/api/client";

/** 品牌知识库条目 */
export interface BrandKnowledgeItem {
  id: string;
  title: string;
  type: string; // brand | product | copy | manual
  tags: unknown;
  source?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandKnowledgeRecallHit {
  id: string;
  title: string;
  content: string;
  type: string;
  tags: unknown;
}

export const knowledgeApi = {
  /** 上传知识条目（文本） */
  upload(input: {
    title: string;
    content: string;
    type?: "brand" | "product" | "copy" | "manual";
    tags?: string[];
    source?: string;
  }) {
    return api.post<BrandKnowledgeItem>("/knowledge/upload", input);
  },

  /** 知识库列表（可按类型过滤） */
  list(type?: string) {
    const params = type ? `?type=${encodeURIComponent(type)}` : "";
    return api.get<BrandKnowledgeItem[]>(`/knowledge/list${params}`);
  },

  /** 删除知识条目 */
  remove(id: string) {
    return api.delete<{ id: string; message: string }>(`/knowledge/${id}`, {});
  },

  /** 按选题召回知识（调试用） */
  recall(query: string, limit = 3) {
    return api.get<BrandKnowledgeRecallHit[]>(
      `/knowledge/recall?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
  },
};
