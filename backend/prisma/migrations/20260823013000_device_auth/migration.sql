-- P0-4 设备级 Token 认证
ALTER TABLE "mobile_devices" ADD COLUMN "device_uuid" TEXT;
ALTER TABLE "mobile_devices" ADD COLUMN "device_token_hash" TEXT;
CREATE INDEX "mobile_devices_device_token_hash_idx" ON "mobile_devices"("device_token_hash");
