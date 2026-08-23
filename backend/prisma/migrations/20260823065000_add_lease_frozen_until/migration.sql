-- P0-1 恢复保护期：心跳超时冻结外发，防重复外发
ALTER TABLE "executor_leases" ADD COLUMN "frozen_until" TIMESTAMP(3);
