"use client";

import { ArticleList } from "../articles/article-list";

export default function ContentXiaohongshuPage() {
  return (
    <ArticleList
      contentType="xiaohongshu"
      title="小红书笔记"
      subtitle="AI 生成的小红书笔记，确认后就能发布"
      emptyTitle="还没有笔记"
      emptyActionLabel="生成新笔记"
      createHref="/content/xiaohongshu-assistant?create=true"
      backHref="/content/xiaohongshu-assistant"
      backLabel="返回小红书助理"
    />
  );
}
