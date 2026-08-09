-- 用户记忆镜像表（B4）：L1 原子记忆本地副本（MemoryCore 不可用时降级检索）
CREATE TABLE "user_memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'episodic',
    "content" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "scene" TEXT,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'chat',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_memories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_memories_user_id_type_idx" ON "user_memories"("user_id", "type");
CREATE INDEX "user_memories_user_id_priority_idx" ON "user_memories"("user_id", "priority");
CREATE UNIQUE INDEX "user_memories_user_id_type_content_key" ON "user_memories"("user_id", "type", "content");
