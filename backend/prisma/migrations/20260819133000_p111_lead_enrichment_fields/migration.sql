-- P1-11 复核：Lead 补统一侧桥接/评分状态 + 身份置信度 + 缺失字段清单
-- （此前 enrichmentStatus/identityConfidence/missingFields 不落库，bridge 后无法对账）
ALTER TABLE "leads" ADD COLUMN "enrichment_status" TEXT;
ALTER TABLE "leads" ADD COLUMN "identity_confidence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN "missing_fields" JSONB NOT NULL DEFAULT '[]';
