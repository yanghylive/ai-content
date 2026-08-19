-- P1-14 复核：RPA 记录来源审计语义（driver/growth-synthesis/legacy-adapter/manual-import）
-- 防御式：本迁移时间序早于 20260819153000_add_rpa_fields（CREATE TABLE），
-- 新库从零 deploy 时表尚不存在 → DO 块判表存在再补列，老库（db push 建表）正常加列。
DO $$ BEGIN
  IF to_regclass('rpa_executions') IS NOT NULL THEN
    ALTER TABLE "rpa_executions" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'driver';
  END IF;
END $$;
