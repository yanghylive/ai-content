-- CreateTable
CREATE TABLE "showcase_cases" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "provenance_type" TEXT NOT NULL,
    "client_visibility" TEXT NOT NULL DEFAULT 'public',
    "primary_platform" TEXT,
    "platforms" TEXT[],
    "primary_industry" TEXT,
    "industries" TEXT[],
    "capability_tags" TEXT[],
    "business_problem" TEXT,
    "solution_summary" TEXT,
    "key_features" JSONB NOT NULL DEFAULT '[]',
    "results_summary" TEXT,
    "evidence_level" TEXT NOT NULL DEFAULT 'E0',
    "evidence_scope" TEXT,
    "delivery_modes" TEXT[],
    "maturity" TEXT NOT NULL DEFAULT 'concept',
    "tech_summary" TEXT,
    "cover_media" JSONB,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "last_reviewed_at" TIMESTAMP(3),
    "next_review_at" TIMESTAMP(3),
    "owner_user_id" TEXT,
    "reviewer_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "showcase_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showcase_media" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "file_url" TEXT,
    "external_url" TEXT,
    "thumbnail_url" TEXT,
    "title" TEXT,
    "caption" TEXT,
    "alt_text" TEXT NOT NULL,
    "device_frame" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "rights_status" TEXT NOT NULL DEFAULT 'unreviewed',
    "sensitive_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "showcase_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showcase_demo_endpoints" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "endpoint_type" TEXT NOT NULL,
    "target_url" TEXT,
    "short_code" TEXT,
    "allowed_devices" TEXT[],
    "iframe_allowed" BOOLEAN NOT NULL DEFAULT false,
    "access_instruction" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "fallback_type" TEXT NOT NULL,
    "fallback_target" TEXT,
    "health_status" TEXT NOT NULL DEFAULT 'unknown',
    "last_checked_at" TIMESTAMP(3),
    "owner_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "showcase_demo_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showcase_authorizations" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "grantor" TEXT,
    "scope" TEXT,
    "license_name" TEXT,
    "source_url" TEXT,
    "version_or_commit" TEXT,
    "attachment" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "review_status" TEXT NOT NULL DEFAULT 'pending',
    "reviewer_user_id" TEXT,
    "restriction_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "showcase_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showcase_collections" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cover_media" JSONB,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "channel_code" TEXT,
    "internal_customer_alias" TEXT,
    "valid_until" TIMESTAMP(3),
    "owner_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "showcase_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showcase_collection_items" (
    "collection_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "showcase_collection_items_pkey" PRIMARY KEY ("collection_id","case_id")
);

-- CreateTable
CREATE TABLE "showcase_short_links" (
    "id" TEXT NOT NULL,
    "short_code" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "target_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "valid_until" TIMESTAMP(3),
    "channel_code" TEXT,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "last_open_at" TIMESTAMP(3),
    "owner_user_id" TEXT,
    "case_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "showcase_short_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showcase_taxonomies" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "showcase_taxonomies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showcase_tag_aliases" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "canonical_taxonomy_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "showcase_tag_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showcase_case_reviews" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "review_type" TEXT NOT NULL,
    "submitted_by" TEXT,
    "reviewed_by" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "comments" TEXT,
    "changed_fields" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "showcase_case_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "showcase_cases_slug_key" ON "showcase_cases"("slug");

-- CreateIndex
CREATE INDEX "showcase_cases_status_idx" ON "showcase_cases"("status");

-- CreateIndex
CREATE INDEX "showcase_cases_provenance_type_idx" ON "showcase_cases"("provenance_type");

-- CreateIndex
CREATE INDEX "showcase_cases_published_at_idx" ON "showcase_cases"("published_at");

-- CreateIndex
CREATE INDEX "showcase_media_case_id_sort_order_idx" ON "showcase_media"("case_id", "sort_order");

-- CreateIndex
CREATE INDEX "showcase_demo_endpoints_case_id_idx" ON "showcase_demo_endpoints"("case_id");

-- CreateIndex
CREATE INDEX "showcase_demo_endpoints_short_code_idx" ON "showcase_demo_endpoints"("short_code");

-- CreateIndex
CREATE INDEX "showcase_authorizations_case_id_idx" ON "showcase_authorizations"("case_id");

-- CreateIndex
CREATE INDEX "showcase_authorizations_review_status_idx" ON "showcase_authorizations"("review_status");

-- CreateIndex
CREATE UNIQUE INDEX "showcase_collections_slug_key" ON "showcase_collections"("slug");

-- CreateIndex
CREATE INDEX "showcase_collections_status_idx" ON "showcase_collections"("status");

-- CreateIndex
CREATE INDEX "showcase_collection_items_case_id_idx" ON "showcase_collection_items"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "showcase_short_links_short_code_key" ON "showcase_short_links"("short_code");

-- CreateIndex
CREATE INDEX "showcase_short_links_target_type_target_id_idx" ON "showcase_short_links"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "showcase_short_links_status_idx" ON "showcase_short_links"("status");

-- CreateIndex
CREATE INDEX "showcase_taxonomies_type_enabled_idx" ON "showcase_taxonomies"("type", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "showcase_taxonomies_type_slug_key" ON "showcase_taxonomies"("type", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "showcase_tag_aliases_alias_key" ON "showcase_tag_aliases"("alias");

-- CreateIndex
CREATE INDEX "showcase_tag_aliases_canonical_taxonomy_id_idx" ON "showcase_tag_aliases"("canonical_taxonomy_id");

-- CreateIndex
CREATE INDEX "showcase_case_reviews_case_id_created_at_idx" ON "showcase_case_reviews"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "showcase_case_reviews_decision_idx" ON "showcase_case_reviews"("decision");

-- AddForeignKey
ALTER TABLE "showcase_media" ADD CONSTRAINT "showcase_media_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "showcase_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showcase_demo_endpoints" ADD CONSTRAINT "showcase_demo_endpoints_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "showcase_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showcase_authorizations" ADD CONSTRAINT "showcase_authorizations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "showcase_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showcase_collection_items" ADD CONSTRAINT "showcase_collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "showcase_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showcase_collection_items" ADD CONSTRAINT "showcase_collection_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "showcase_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showcase_short_links" ADD CONSTRAINT "showcase_short_links_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "showcase_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showcase_tag_aliases" ADD CONSTRAINT "showcase_tag_aliases_canonical_taxonomy_id_fkey" FOREIGN KEY ("canonical_taxonomy_id") REFERENCES "showcase_taxonomies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showcase_case_reviews" ADD CONSTRAINT "showcase_case_reviews_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "showcase_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

