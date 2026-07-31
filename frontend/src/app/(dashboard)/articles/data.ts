export const columns = [
    { name: "标题 / 摘要", uid: "title" },
    { name: "所属选题", uid: "topic" },
    { name: "状态", uid: "status" },
    { name: "生成时间", uid: "createdAt" },
    { name: "操作", uid: "actions" },
];

export const statusMap: Record<string, { label: string; color: "default" | "primary" | "secondary" | "success" | "warning" | "danger" }> = {
    draft: { label: "草稿", color: "warning" },
    published: { label: "已发布", color: "success" },
};
