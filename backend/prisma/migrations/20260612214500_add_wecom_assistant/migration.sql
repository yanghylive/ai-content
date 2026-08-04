-- 企业微信 AI 客服助手：连接器、自动回复设置、发送记录
CREATE TABLE IF NOT EXISTS "wecom_assistant_integrations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "encrypted_webhook_url" TEXT NOT NULL,
  "masked_webhook_url" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_tested_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wecom_assistant_integrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "wecom_assistant_settings" (
  "id" TEXT NOT NULL,
  "integration_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "brand_name" TEXT,
  "store_name" TEXT,
  "reply_style" TEXT,
  "transfer_keywords" JSONB NOT NULL DEFAULT '[]',
  "send_to_wecom" BOOLEAN NOT NULL DEFAULT true,
  "auto_send_to_customer" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wecom_assistant_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "wecom_outbound_messages" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "integration_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'wecom',
  "message_type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error_message" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wecom_outbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wecom_assistant_settings_integration_id_key" ON "wecom_assistant_settings"("integration_id");
CREATE INDEX IF NOT EXISTS "wecom_assistant_integrations_user_id_idx" ON "wecom_assistant_integrations"("user_id");
CREATE INDEX IF NOT EXISTS "wecom_assistant_integrations_status_idx" ON "wecom_assistant_integrations"("status");
CREATE INDEX IF NOT EXISTS "wecom_assistant_integrations_updated_at_idx" ON "wecom_assistant_integrations"("updated_at");
CREATE INDEX IF NOT EXISTS "wecom_assistant_settings_user_id_idx" ON "wecom_assistant_settings"("user_id");
CREATE INDEX IF NOT EXISTS "wecom_outbound_messages_user_id_idx" ON "wecom_outbound_messages"("user_id");
CREATE INDEX IF NOT EXISTS "wecom_outbound_messages_integration_id_idx" ON "wecom_outbound_messages"("integration_id");
CREATE INDEX IF NOT EXISTS "wecom_outbound_messages_status_idx" ON "wecom_outbound_messages"("status");
CREATE INDEX IF NOT EXISTS "wecom_outbound_messages_created_at_idx" ON "wecom_outbound_messages"("created_at");

DO $$ BEGIN
  ALTER TABLE "wecom_assistant_settings"
    ADD CONSTRAINT "wecom_assistant_settings_integration_id_fkey"
    FOREIGN KEY ("integration_id") REFERENCES "wecom_assistant_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "wecom_outbound_messages"
    ADD CONSTRAINT "wecom_outbound_messages_integration_id_fkey"
    FOREIGN KEY ("integration_id") REFERENCES "wecom_assistant_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
