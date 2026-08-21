-- P2 归因主键链：CrmCustomer 补充来源内容/发布/互动/获客任务/运行引用（2026-08-20）
-- 全部 nullable、无 backfill：历史客户不追溯，前端 null 语义展示「暂无归因」。
ALTER TABLE IF EXISTS "crm_customers"
  ADD COLUMN IF NOT EXISTS "source_article_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_publish_record_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_interaction_event_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_task_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_run_id" TEXT;