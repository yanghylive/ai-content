-- CRM Lite P0：公司、联系人扩展、商机、任务、备注和跨对象时间线。

ALTER TABLE "crm_customers"
  ADD COLUMN IF NOT EXISTS "company_id" TEXT,
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "wechat" TEXT;

CREATE TABLE IF NOT EXISTS "crm_companies" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT,
  "industry" TEXT,
  "phone" TEXT,
  "website" TEXT,
  "city" TEXT,
  "employees" INTEGER,
  "annual_revenue_cents" INTEGER NOT NULL DEFAULT 0,
  "owner_user_id" TEXT,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "metadata" JSONB,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_opportunities" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "stage" TEXT NOT NULL DEFAULT 'qualified',
  "amount_cents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "probability" INTEGER NOT NULL DEFAULT 20,
  "company_id" TEXT,
  "primary_customer_id" TEXT,
  "close_date" TIMESTAMP(3),
  "next_step" TEXT,
  "competitor" TEXT,
  "source" TEXT,
  "metadata" JSONB,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_tasks" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "due_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "assignee_id" TEXT,
  "company_id" TEXT,
  "customer_id" TEXT,
  "opportunity_id" TEXT,
  "metadata" JSONB,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_notes" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_by" TEXT,
  "company_id" TEXT,
  "customer_id" TEXT,
  "opportunity_id" TEXT,
  "metadata" JSONB,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "crm_timeline_events"
  ADD COLUMN IF NOT EXISTS "company_id" TEXT,
  ADD COLUMN IF NOT EXISTS "opportunity_id" TEXT,
  ADD COLUMN IF NOT EXISTS "task_id" TEXT,
  ADD COLUMN IF NOT EXISTS "note_id" TEXT;

CREATE INDEX IF NOT EXISTS "crm_customers_company_id_idx" ON "crm_customers"("company_id");
CREATE INDEX IF NOT EXISTS "crm_customers_email_idx" ON "crm_customers"("email");
CREATE INDEX IF NOT EXISTS "crm_customers_phone_idx" ON "crm_customers"("phone");

CREATE INDEX IF NOT EXISTS "crm_companies_owner_id_idx" ON "crm_companies"("owner_id");
CREATE INDEX IF NOT EXISTS "crm_companies_name_idx" ON "crm_companies"("name");
CREATE INDEX IF NOT EXISTS "crm_companies_domain_idx" ON "crm_companies"("domain");
CREATE INDEX IF NOT EXISTS "crm_companies_industry_idx" ON "crm_companies"("industry");
CREATE INDEX IF NOT EXISTS "crm_companies_updated_at_idx" ON "crm_companies"("updated_at");

CREATE INDEX IF NOT EXISTS "crm_opportunities_owner_id_idx" ON "crm_opportunities"("owner_id");
CREATE INDEX IF NOT EXISTS "crm_opportunities_company_id_idx" ON "crm_opportunities"("company_id");
CREATE INDEX IF NOT EXISTS "crm_opportunities_primary_customer_id_idx" ON "crm_opportunities"("primary_customer_id");
CREATE INDEX IF NOT EXISTS "crm_opportunities_stage_idx" ON "crm_opportunities"("stage");
CREATE INDEX IF NOT EXISTS "crm_opportunities_close_date_idx" ON "crm_opportunities"("close_date");
CREATE INDEX IF NOT EXISTS "crm_opportunities_updated_at_idx" ON "crm_opportunities"("updated_at");

CREATE INDEX IF NOT EXISTS "crm_tasks_owner_id_idx" ON "crm_tasks"("owner_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_company_id_idx" ON "crm_tasks"("company_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_customer_id_idx" ON "crm_tasks"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_opportunity_id_idx" ON "crm_tasks"("opportunity_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_status_idx" ON "crm_tasks"("status");
CREATE INDEX IF NOT EXISTS "crm_tasks_priority_idx" ON "crm_tasks"("priority");
CREATE INDEX IF NOT EXISTS "crm_tasks_due_at_idx" ON "crm_tasks"("due_at");
CREATE INDEX IF NOT EXISTS "crm_tasks_updated_at_idx" ON "crm_tasks"("updated_at");

CREATE INDEX IF NOT EXISTS "crm_notes_owner_id_idx" ON "crm_notes"("owner_id");
CREATE INDEX IF NOT EXISTS "crm_notes_company_id_idx" ON "crm_notes"("company_id");
CREATE INDEX IF NOT EXISTS "crm_notes_customer_id_idx" ON "crm_notes"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_notes_opportunity_id_idx" ON "crm_notes"("opportunity_id");
CREATE INDEX IF NOT EXISTS "crm_notes_created_at_idx" ON "crm_notes"("created_at");

CREATE INDEX IF NOT EXISTS "crm_timeline_events_company_id_idx" ON "crm_timeline_events"("company_id");
CREATE INDEX IF NOT EXISTS "crm_timeline_events_opportunity_id_idx" ON "crm_timeline_events"("opportunity_id");
CREATE INDEX IF NOT EXISTS "crm_timeline_events_task_id_idx" ON "crm_timeline_events"("task_id");
CREATE INDEX IF NOT EXISTS "crm_timeline_events_note_id_idx" ON "crm_timeline_events"("note_id");

DO $$ BEGIN
  ALTER TABLE "crm_customers"
    ADD CONSTRAINT "crm_customers_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_primary_customer_id_fkey"
    FOREIGN KEY ("primary_customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_tasks"
    ADD CONSTRAINT "crm_tasks_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_tasks"
    ADD CONSTRAINT "crm_tasks_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_tasks"
    ADD CONSTRAINT "crm_tasks_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_notes"
    ADD CONSTRAINT "crm_notes_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_notes"
    ADD CONSTRAINT "crm_notes_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_notes"
    ADD CONSTRAINT "crm_notes_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_timeline_events"
    ADD CONSTRAINT "crm_timeline_events_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_timeline_events"
    ADD CONSTRAINT "crm_timeline_events_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_timeline_events"
    ADD CONSTRAINT "crm_timeline_events_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "crm_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "crm_timeline_events"
    ADD CONSTRAINT "crm_timeline_events_note_id_fkey"
    FOREIGN KEY ("note_id") REFERENCES "crm_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
