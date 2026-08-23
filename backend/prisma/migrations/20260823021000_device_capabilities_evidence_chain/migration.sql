-- P1-14 设备能力上报 + P1-18 证据审计链
ALTER TABLE "mobile_devices" ADD COLUMN "capabilities" JSONB;

ALTER TABLE "executor_evidences" ADD COLUMN "content_hash" TEXT;
ALTER TABLE "executor_evidences" ADD COLUMN "prev_evidence_id" TEXT;
ALTER TABLE "executor_evidences" ADD COLUMN "device_id" TEXT;
ALTER TABLE "executor_evidences" ADD COLUMN "model_version" TEXT;
ALTER TABLE "executor_evidences" ADD COLUMN "policy_version" TEXT;
ALTER TABLE "executor_evidences" ADD COLUMN "approval_id" TEXT;
ALTER TABLE "executor_evidences" ADD COLUMN "collected_at" TIMESTAMP(3);
CREATE INDEX "executor_evidences_content_hash_idx" ON "executor_evidences"("content_hash");
