-- P1-14 复核：RPA 记录来源审计语义（driver/growth-synthesis/legacy-adapter/manual-import）
ALTER TABLE "rpa_executions" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'driver';
