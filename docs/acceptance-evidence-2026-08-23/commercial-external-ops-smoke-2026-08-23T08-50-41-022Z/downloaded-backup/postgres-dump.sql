--
-- PostgreSQL database dump
--

\restrict bE7vXT7aP9HO95QDfyKBgHx2Gt8ksJ335bYCFlTdvl78fhzcFh4LgjSg0fd3r3U

-- Dumped from database version 15.18
-- Dumped by pg_dump version 16.15 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: AgentConfirmationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentConfirmationStatus" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'expired'
);


--
-- Name: AgentRiskLevel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentRiskLevel" AS ENUM (
    'low',
    'medium',
    'high'
);


--
-- Name: AgentSessionSource; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentSessionSource" AS ENUM (
    'web',
    'agent_console',
    'publishing',
    'interaction',
    'system'
);


--
-- Name: AgentSessionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AgentSessionStatus" AS ENUM (
    'draft',
    'running',
    'waiting_for_confirmation',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: InteractionTaskStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."InteractionTaskStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'WAITING_FOR_SEND_CONFIRMATION',
    'COMPLETED',
    'FAILED',
    'BLOCKED',
    'SKIPPED',
    'NO_TARGET',
    'PAUSED'
);


--
-- Name: InteractionTaskType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."InteractionTaskType" AS ENUM (
    'DOUYIN_COMMENT_REPLY',
    'DOUYIN_DIRECT_MESSAGE_REPLY',
    'WECHAT_REPLY_DRAFT',
    'WECHAT_GROUP_BROADCAST',
    'WECHAT_MOMENTS_PUBLISH',
    'CUSTOMER_FOLLOW_UP',
    'WECHAT_CHANNEL_COMMENT_REPLY',
    'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
    'WECHAT_CONTACT_ADD',
    'WECHAT_MOMENTS_MARKETING',
    'WECHAT_FRIEND_ACCEPT'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: account_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_subscriptions (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    platform text DEFAULT 'douyin'::text NOT NULL,
    account_id text NOT NULL,
    account_name text,
    account_url text,
    active boolean DEFAULT true NOT NULL,
    last_fetched_at timestamp(3) without time zone,
    last_snapshot jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: acquisition_quotas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acquisition_quotas (
    id text NOT NULL,
    user_id text NOT NULL,
    date date NOT NULL,
    discover_count integer DEFAULT 0 NOT NULL,
    discover_limit integer DEFAULT 100 NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: activation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activation_events (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    event_type text NOT NULL,
    ref_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_call_traces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_call_traces (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    scene text NOT NULL,
    model_id text,
    model_name text,
    prompt_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    completion text,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    latency_ms integer DEFAULT 0 NOT NULL,
    success boolean DEFAULT true NOT NULL,
    error_msg text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_chat_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_chat_logs (
    id text NOT NULL,
    user_id text NOT NULL,
    session_id text,
    model text,
    platform text,
    messages integer DEFAULT 0 NOT NULL,
    tool_calls integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    error_msg text,
    duration_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_credit_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_credit_accounts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    balance numeric(12,2) DEFAULT 0 NOT NULL,
    total_granted numeric(12,2) DEFAULT 0 NOT NULL,
    total_consumed numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: ai_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_models (
    id text NOT NULL,
    name text NOT NULL,
    model_id text NOT NULL,
    platform_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: ai_platforms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_platforms (
    id text NOT NULL,
    name text NOT NULL,
    base_url text NOT NULL,
    api_key text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: ai_tool_call_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_tool_call_logs (
    id text NOT NULL,
    user_id text NOT NULL,
    tool text NOT NULL,
    args_json text NOT NULL,
    result_ok boolean NOT NULL,
    error_msg text,
    duration_ms integer DEFAULT 0 NOT NULL,
    confirmed boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tokens_used integer DEFAULT 0 NOT NULL,
    cost_points integer DEFAULT 0 NOT NULL
);


--
-- Name: ai_usage_quotas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_quotas (
    id text NOT NULL,
    user_id text NOT NULL,
    date date NOT NULL,
    chat_count integer DEFAULT 0 NOT NULL,
    tool_count integer DEFAULT 0 NOT NULL,
    chat_limit integer DEFAULT 50 NOT NULL,
    tool_limit integer DEFAULT 100 NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    token_count integer DEFAULT 0 NOT NULL,
    token_limit integer DEFAULT 2000000 NOT NULL
);


--
-- Name: app_install_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_install_states (
    id text NOT NULL,
    user_id text NOT NULL,
    app_key text NOT NULL,
    purchase_status text DEFAULT 'not_purchased'::text NOT NULL,
    install_status text DEFAULT 'not_installed'::text NOT NULL,
    entitlement_snapshot jsonb,
    settings jsonb,
    purchased_at timestamp(3) without time zone,
    installed_at timestamp(3) without time zone,
    uninstalled_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    tenant_id text,
    actor_user_id text
);


--
-- Name: approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approvals (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    action_id text NOT NULL,
    action_type text NOT NULL,
    risk_level text NOT NULL,
    input_hash text NOT NULL,
    affected_lead_ids jsonb NOT NULL,
    excluded_lead_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    approver_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    reason text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone,
    applied_at timestamp(3) without time zone
);


--
-- Name: articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.articles (
    id text NOT NULL,
    topic_id text,
    title text NOT NULL,
    content text NOT NULL,
    style_id text,
    model_id text,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    cover_image text,
    content_format text DEFAULT 'markdown'::text NOT NULL,
    raw_html text,
    final_html text,
    template_id text,
    content_type text DEFAULT 'article'::text NOT NULL,
    xiaohongshu_data jsonb,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    wechat_data jsonb,
    workspace_brief jsonb,
    workspace_outline jsonb,
    workspace_step text DEFAULT 'brief'::text NOT NULL,
    workspace_revision integer DEFAULT 1 NOT NULL,
    parent_id text
);


--
-- Name: attribution_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attribution_links (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text NOT NULL,
    from_type text NOT NULL,
    from_id text NOT NULL,
    to_type text NOT NULL,
    to_id text NOT NULL,
    model text DEFAULT 'deterministic'::text NOT NULL,
    confidence text DEFAULT 'high'::text NOT NULL,
    label text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: benchmark_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.benchmark_accounts (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    intelligence_item_id text,
    growth_lead_id text,
    platform text NOT NULL,
    nickname text NOT NULL,
    external_user_id text,
    profile_url text,
    avatar_url text,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason text,
    diagnosis jsonb,
    status text DEFAULT 'watching'::text NOT NULL,
    raw jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: billing_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_invoices (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider text NOT NULL,
    external_invoice_id text NOT NULL,
    external_customer_id text,
    external_subscription_id text,
    status text DEFAULT 'open'::text NOT NULL,
    amount_due integer DEFAULT 0 NOT NULL,
    amount_paid integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    hosted_invoice_url text,
    invoice_pdf_url text,
    attempted_at timestamp(3) without time zone,
    paid_at timestamp(3) without time zone,
    failed_at timestamp(3) without time zone,
    latest_webhook_event_id text,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: billing_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_subscriptions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    provider text NOT NULL,
    external_customer_id text,
    external_subscription_id text NOT NULL,
    plan text DEFAULT 'FREE'::text NOT NULL,
    status text DEFAULT 'inactive'::text NOT NULL,
    current_period_start timestamp(3) without time zone,
    current_period_end timestamp(3) without time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    latest_webhook_event_id text,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: billing_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_webhook_events (
    id text NOT NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    tenant_id text,
    external_customer_id text,
    external_subscription_id text,
    signature_verified boolean DEFAULT false NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    error_message text,
    processed_at timestamp(3) without time zone,
    payload jsonb NOT NULL,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: boss_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boss_accounts (
    id text NOT NULL,
    user_id text NOT NULL,
    name text DEFAULT 'Boss 直聘'::text NOT NULL,
    storage_state_path text,
    last_checked_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    login_status text DEFAULT 'unknown'::text NOT NULL
);


--
-- Name: boss_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boss_candidates (
    id text NOT NULL,
    user_id text NOT NULL,
    account_id text NOT NULL,
    name text NOT NULL,
    job_title text,
    wechat_id text,
    status text DEFAULT 'new'::text NOT NULL,
    notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: boss_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boss_tasks (
    id text NOT NULL,
    user_id text NOT NULL,
    account_id text NOT NULL,
    task_type text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    result jsonb,
    error_message text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: brand_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_knowledge (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    type text DEFAULT 'brand'::text NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    source text,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: client_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_configs (
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: comment_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comment_insights (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    intelligence_item_id text,
    growth_lead_id text,
    redfox_call_log_id text,
    platform text NOT NULL,
    source_url text,
    source_external_id text,
    pain_points jsonb DEFAULT '[]'::jsonb NOT NULL,
    intent_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    demand_signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    objections jsonb DEFAULT '[]'::jsonb NOT NULL,
    reply_suggestions jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw jsonb,
    analyzed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: compliance_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_checks (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    material_id text,
    topic_id text,
    redfox_call_log_id text,
    target_type text NOT NULL,
    target_id text,
    platform text NOT NULL,
    risk_level text DEFAULT 'unknown'::text NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    suggestions jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw jsonb,
    checked_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: content_asset_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_asset_versions (
    id text NOT NULL,
    tenant_id text,
    asset_type text NOT NULL,
    asset_id text NOT NULL,
    version_no integer NOT NULL,
    snapshot text NOT NULL,
    change_summary text,
    actor_user_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: content_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_drafts (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    source_type text,
    source_id text,
    title text NOT NULL,
    content text NOT NULL,
    platform text DEFAULT 'all'::text NOT NULL,
    target_type text DEFAULT 'article'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    official_version_id text,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: content_evidence_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_evidence_logs (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    action text NOT NULL,
    snapshot jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: content_manual_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_manual_reviews (
    id text NOT NULL,
    version_id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    risk_level text,
    note text,
    reviewer_name text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: content_optimization_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_optimization_runs (
    id text NOT NULL,
    draft_id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    mode text NOT NULL,
    platform text DEFAULT 'all'::text NOT NULL,
    input jsonb,
    result jsonb,
    source_workflow_id text,
    source_summary text,
    cost_points integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: content_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_plans (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    actor_user_id text,
    name text NOT NULL,
    goal text NOT NULL,
    audience text,
    core_claim text,
    offer text,
    platforms jsonb DEFAULT '[]'::jsonb NOT NULL,
    success_metric text,
    evidence_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: content_publish_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_publish_feedback (
    id text NOT NULL,
    version_id text NOT NULL,
    publish_intent_id text,
    tenant_id text,
    user_id text NOT NULL,
    platform text DEFAULT 'all'::text NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    likes integer DEFAULT 0 NOT NULL,
    comments integer DEFAULT 0 NOT NULL,
    saves integer DEFAULT 0 NOT NULL,
    leads integer DEFAULT 0 NOT NULL,
    note text,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: content_publish_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_publish_intents (
    id text NOT NULL,
    version_id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    platform text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    status text DEFAULT 'ready'::text NOT NULL,
    scheduled_at timestamp(3) without time zone,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: content_strategies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_strategies (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    industry text DEFAULT '通用'::text NOT NULL,
    target_audience text NOT NULL,
    commercial_goal text NOT NULL,
    core_pain_points text NOT NULL,
    writing_angles text NOT NULL,
    tone_and_style text,
    is_default boolean DEFAULT false NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: content_strategy_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_strategy_templates (
    id text NOT NULL,
    industry text NOT NULL,
    type text NOT NULL,
    scene text,
    hook text,
    title text,
    content text,
    tone_hint text,
    is_hot boolean DEFAULT false NOT NULL,
    source text DEFAULT 'seed'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: content_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_variants (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    content_unit_id text NOT NULL,
    platform text NOT NULL,
    body text NOT NULL,
    title text,
    platform_metadata jsonb,
    content_hash text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    copyright_notice text,
    license_status text DEFAULT 'unknown'::text NOT NULL
);


--
-- Name: content_version_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_version_comments (
    id text NOT NULL,
    version_id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    body text NOT NULL,
    author_name text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: content_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_versions (
    id text NOT NULL,
    draft_id text NOT NULL,
    run_id text,
    tenant_id text,
    user_id text NOT NULL,
    mode text NOT NULL,
    mode_label text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    platform text DEFAULT 'all'::text NOT NULL,
    target_type text DEFAULT 'article'::text NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'saved'::text NOT NULL,
    is_official boolean DEFAULT false NOT NULL,
    source_workflow_id text,
    source_summary text,
    compliance_check_id text,
    compliance_risk_level text,
    compliance_risk_score integer,
    compliance_summary text,
    compliance_checked_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: cps_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cps_favorites (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    vendor_code text NOT NULL,
    platform_code text NOT NULL,
    item_id text NOT NULL,
    title text NOT NULL,
    image_url text,
    pay_price numeric(10,2) NOT NULL,
    coupon_amount numeric(10,2) DEFAULT 0 NOT NULL,
    est_rebate numeric(10,2) DEFAULT 0 NOT NULL,
    est_net_cost numeric(10,2) DEFAULT 0 NOT NULL,
    commission_rate numeric(6,2),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cps_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cps_orders (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    vendor_code text NOT NULL,
    platform_code text NOT NULL,
    order_no text NOT NULL,
    item_id text,
    pay_amount numeric(10,2) NOT NULL,
    est_commission numeric(10,2) NOT NULL,
    act_commission numeric(10,2) DEFAULT 0 NOT NULL,
    user_rebate numeric(10,2) DEFAULT 0 NOT NULL,
    platform_share numeric(10,2) DEFAULT 0 NOT NULL,
    status text NOT NULL,
    refund_amount numeric(10,2) DEFAULT 0 NOT NULL,
    paid_at timestamp(3) without time zone,
    settled_at timestamp(3) without time zone,
    raw_status text,
    sync_checkpoint text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: cps_platforms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cps_platforms (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "settleDays" integer DEFAULT 30 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cps_promo_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cps_promo_links (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    vendor_code text NOT NULL,
    platform_code text NOT NULL,
    item_id text NOT NULL,
    original_url text NOT NULL,
    promo_url text NOT NULL,
    idempotency_key text NOT NULL,
    attribution jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cps_vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cps_vendors (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    platform_code text NOT NULL,
    app_key_enc text NOT NULL,
    app_secret_enc text NOT NULL,
    pid text,
    priority integer DEFAULT 100 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: crm_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_audit_events (
    id text NOT NULL,
    owner_id text NOT NULL,
    tenant_id text,
    import_batch_id text,
    event_type text NOT NULL,
    action text NOT NULL,
    status text DEFAULT 'success'::text NOT NULL,
    proof_hash text,
    external_network boolean DEFAULT false NOT NULL,
    external_crm_touched boolean DEFAULT false NOT NULL,
    write_tables jsonb DEFAULT '[]'::jsonb NOT NULL,
    read_tables jsonb DEFAULT '[]'::jsonb NOT NULL,
    summary text,
    payload jsonb,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: crm_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_companies (
    id text NOT NULL,
    owner_id text NOT NULL,
    name text NOT NULL,
    domain text,
    industry text,
    phone text,
    website text,
    city text,
    employees integer,
    annual_revenue_cents integer DEFAULT 0 NOT NULL,
    owner_user_id text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb,
    archived_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    tenant_id text,
    actor_user_id text
);


--
-- Name: crm_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_customers (
    id text NOT NULL,
    owner_id text NOT NULL,
    display_name text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    source_platform text,
    source_keyword text,
    matched_keyword text,
    source_url text,
    source_text text,
    latest_reply text,
    score integer DEFAULT 0 NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    profile_url text,
    external_user_id text,
    dedupe_key text,
    assigned_user_id text,
    first_interaction_task_id text,
    latest_interaction_task_id text,
    metadata jsonb,
    archived_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    company_id text,
    title text,
    email text,
    phone text,
    wechat text,
    tenant_id text,
    actor_user_id text,
    source_article_id text,
    source_publish_record_id text,
    source_interaction_event_id text,
    source_task_id text,
    source_run_id text
);


--
-- Name: crm_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_import_batches (
    id text NOT NULL,
    owner_id text NOT NULL,
    tenant_id text,
    source_type text NOT NULL,
    filename text,
    status text DEFAULT 'committed'::text NOT NULL,
    mode text DEFAULT 'local-crm-write'::text NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    committed_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    duplicate_count integer DEFAULT 0 NOT NULL,
    warning_count integer DEFAULT 0 NOT NULL,
    dry_run_id text,
    dry_run_proof_hash text,
    commit_proof_hash text NOT NULL,
    rollback_token text NOT NULL,
    rollback_proof_hash text,
    rollback_reason text,
    mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    quality_issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    customer_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    write_tables jsonb DEFAULT '[]'::jsonb NOT NULL,
    external_network boolean DEFAULT false NOT NULL,
    external_crm_touched boolean DEFAULT false NOT NULL,
    committed_at timestamp(3) without time zone,
    rolled_back_at timestamp(3) without time zone,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: crm_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_notes (
    id text NOT NULL,
    owner_id text NOT NULL,
    body text NOT NULL,
    created_by text,
    company_id text,
    customer_id text,
    opportunity_id text,
    metadata jsonb,
    archived_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    tenant_id text,
    actor_user_id text
);


--
-- Name: crm_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_opportunities (
    id text NOT NULL,
    owner_id text NOT NULL,
    name text NOT NULL,
    stage text DEFAULT 'qualified'::text NOT NULL,
    amount_cents integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    probability integer DEFAULT 20 NOT NULL,
    company_id text,
    primary_customer_id text,
    close_date timestamp(3) without time zone,
    next_step text,
    competitor text,
    source text,
    metadata jsonb,
    archived_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    tenant_id text,
    actor_user_id text,
    lose_reason text,
    win_reason text,
    next_action_at timestamp(3) without time zone
);


--
-- Name: crm_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_tasks (
    id text NOT NULL,
    owner_id text NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    due_at timestamp(3) without time zone,
    completed_at timestamp(3) without time zone,
    assignee_id text,
    company_id text,
    customer_id text,
    opportunity_id text,
    metadata jsonb,
    archived_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    tenant_id text,
    actor_user_id text
);


--
-- Name: crm_timeline_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_timeline_events (
    id text NOT NULL,
    owner_id text NOT NULL,
    customer_id text,
    related_interaction_task_id text,
    related_runtime_execution_id text,
    event_type text NOT NULL,
    channel text,
    content text,
    reply_content text,
    status text,
    failure_reason text,
    evidence jsonb,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    company_id text,
    opportunity_id text,
    task_id text,
    note_id text,
    tenant_id text,
    actor_user_id text
);


--
-- Name: default_model_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.default_model_configs (
    id text NOT NULL,
    purpose text NOT NULL,
    model_id text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: domain_event_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.domain_event_outbox (
    id text NOT NULL,
    event_id text NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    type text NOT NULL,
    idempotency_key text NOT NULL,
    occurred_at timestamp(3) without time zone NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    last_error text,
    consumed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: entitlement_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlement_snapshots (
    id text NOT NULL,
    tenant_id text,
    user_id text,
    plan text NOT NULL,
    "planMode" text,
    source text NOT NULL,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    blockers jsonb DEFAULT '[]'::jsonb NOT NULL,
    context text,
    ref_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: executor_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.executor_tasks (
    id text NOT NULL,
    user_id text NOT NULL,
    device_id text,
    type text DEFAULT 'publish'::text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    result jsonb,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    executed_at timestamp(3) without time zone
);


--
-- Name: exposure_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exposure_accounts (
    id text NOT NULL,
    platform text DEFAULT 'douyin'::text NOT NULL,
    account_id text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    note text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    user_id text DEFAULT ''::text NOT NULL
);


--
-- Name: geo_bridge_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geo_bridge_tasks (
    id text NOT NULL,
    action_id text NOT NULL,
    action_type text NOT NULL,
    action_title text NOT NULL,
    status text DEFAULT 'sent_to_ai_content'::text NOT NULL,
    source text DEFAULT 'kaypal-geo'::text NOT NULL,
    brand_id text,
    brand_name text,
    platform text,
    brief text,
    goal text,
    reason text,
    retest_window text,
    return_url text,
    callback_url text,
    keyword text,
    content_preview text,
    result_url text,
    published_url text,
    last_callback_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: growth_account_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_account_health (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    platform text NOT NULL,
    account_id text NOT NULL,
    account_name text NOT NULL,
    login_status text NOT NULL,
    today_action_count integer DEFAULT 0 NOT NULL,
    failure_rate double precision DEFAULT 0 NOT NULL,
    risk_status text NOT NULL,
    cooldown_until timestamp(3) without time zone,
    recommendation text NOT NULL,
    last_checked_at timestamp(3) without time zone NOT NULL
);


--
-- Name: growth_account_health_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_account_health_snapshots (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    platform text NOT NULL,
    account_id text NOT NULL,
    account_name text NOT NULL,
    login_status text NOT NULL,
    today_action_count integer DEFAULT 0 NOT NULL,
    failure_rate double precision DEFAULT 0 NOT NULL,
    risk_status text NOT NULL,
    cooldown_until timestamp(3) without time zone,
    recommendation text NOT NULL,
    checked_at timestamp(3) without time zone NOT NULL
);


--
-- Name: growth_acquisition_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_acquisition_configs (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    mode text NOT NULL,
    task_name text NOT NULL,
    platform text NOT NULL,
    account_id text NOT NULL,
    account_name text,
    source_inputs jsonb DEFAULT '[]'::jsonb NOT NULL,
    include_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    exclude_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    blacklist_nicknames jsonb DEFAULT '[]'::jsonb NOT NULL,
    comment_templates jsonb DEFAULT '[]'::jsonb NOT NULL,
    private_message_templates jsonb DEFAULT '[]'::jsonb NOT NULL,
    daily_limit integer DEFAULT 20 NOT NULL,
    per_target_limit integer DEFAULT 1 NOT NULL,
    deduplicate boolean DEFAULT true NOT NULL,
    schedule_enabled boolean DEFAULT false NOT NULL,
    begin_time text DEFAULT '09:30'::text NOT NULL,
    risk_mode text DEFAULT 'confirm-first'::text NOT NULL,
    status text DEFAULT 'enabled'::text NOT NULL,
    exposure_count integer DEFAULT 0 NOT NULL,
    exposure_date text NOT NULL,
    last_run_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    actor_user_id text
);


--
-- Name: growth_acquisition_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_acquisition_runs (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    config_id text NOT NULL,
    mode text NOT NULL,
    platform text NOT NULL,
    status text NOT NULL,
    failure_reason text,
    message text NOT NULL,
    candidate_count integer DEFAULT 0 NOT NULL,
    selected_count integer DEFAULT 0 NOT NULL,
    contacted_count integer DEFAULT 0 NOT NULL,
    crm_captured_count integer DEFAULT 0 NOT NULL,
    evidence_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    lead_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp(3) without time zone NOT NULL,
    ended_at timestamp(3) without time zone,
    actor_user_id text
);


--
-- Name: growth_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_leads (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    platform text NOT NULL,
    source_type text NOT NULL,
    source_task_id text,
    source_run_id text,
    crm_customer_id text,
    nickname text NOT NULL,
    profile_url text,
    avatar_url text,
    external_user_id text,
    source_text text NOT NULL,
    source_url text,
    video_title text,
    video_url text,
    comment_time text,
    matched_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    score_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    next_follow_up_at timestamp(3) without time zone,
    owner_user_id text,
    notes jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    latest_reply text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: growth_scheduler_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_scheduler_leases (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    owner_id text NOT NULL,
    locked_until timestamp(3) without time zone NOT NULL,
    heartbeat_at timestamp(3) without time zone,
    last_run_at timestamp(3) without time zone,
    cursor jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: growth_strategies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_strategies (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    industry text NOT NULL,
    scenario text NOT NULL,
    name text NOT NULL,
    source_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    demand_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    exclude_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    blacklist_nicknames jsonb DEFAULT '[]'::jsonb NOT NULL,
    comment_templates jsonb DEFAULT '[]'::jsonb NOT NULL,
    private_message_templates jsonb DEFAULT '[]'::jsonb NOT NULL,
    default_daily_limit integer DEFAULT 20 NOT NULL,
    default_risk_mode text DEFAULT 'confirm-first'::text NOT NULL,
    scoring_rules jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    actor_user_id text
);


--
-- Name: growth_task_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_task_drafts (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text NOT NULL,
    actor_user_id text,
    intent text NOT NULL,
    goal text NOT NULL,
    platform text,
    account_id text,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    planned_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    missing_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    readiness text DEFAULT 'needs-input'::text NOT NULL,
    blockers jsonb DEFAULT '[]'::jsonb NOT NULL,
    draft_hash text,
    risk_summary text,
    config_id text,
    status text DEFAULT 'draft'::text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    confirmed_at timestamp(3) without time zone,
    executed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: growth_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_workflows (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    name text NOT NULL,
    template text NOT NULL,
    status text NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    current_step_id text,
    last_action text,
    last_action_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    industry text,
    scenario text
);


--
-- Name: identity_merge_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_merge_audits (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    target_id text NOT NULL,
    source_id text NOT NULL,
    source_snapshot jsonb NOT NULL,
    migrated_event_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    migrated_content_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    field_choices jsonb,
    reverted boolean DEFAULT false NOT NULL,
    reverted_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: intelligence_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_items (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    source_id text,
    redfox_skill_id text,
    redfox_call_log_id text,
    material_id text,
    topic_id text,
    growth_lead_id text,
    platform text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    content text,
    summary text,
    source_url text,
    source_external_id text,
    author text,
    author_url text,
    publish_date timestamp(3) without time zone,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw jsonb,
    status text DEFAULT 'new'::text NOT NULL,
    dedupe_key text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: intelligence_monitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_monitors (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    skill_install_id text,
    type text NOT NULL,
    platform text,
    keyword text,
    account_external_id text,
    industry text,
    schedule text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    config jsonb,
    cost_limit_points integer,
    last_run_at timestamp(3) without time zone,
    next_run_at timestamp(3) without time zone,
    last_error text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: intelligence_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_reports (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    audience text,
    owner text,
    range_key text,
    status text DEFAULT 'draft'::text NOT NULL,
    completeness integer DEFAULT 0 NOT NULL,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    markdown text NOT NULL,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: interaction_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interaction_events (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    platform text NOT NULL,
    account_id text,
    channel text DEFAULT 'comment'::text NOT NULL,
    external_event_id text,
    external_thread_id text,
    author_external_id text,
    source_url text,
    source_article_id text,
    publish_record_id text,
    body text,
    dedupe_key text NOT NULL,
    occurred_at timestamp(3) without time zone NOT NULL,
    raw jsonb,
    identity_id text,
    content_id text,
    parent_event_id text,
    evidence_url text,
    raw_hash text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    comment_ref text
);


--
-- Name: interaction_task_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interaction_task_events (
    id text NOT NULL,
    "taskId" text NOT NULL,
    stage text NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    message text NOT NULL,
    payload jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: interaction_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interaction_tasks (
    id text NOT NULL,
    "taskType" public."InteractionTaskType" NOT NULL,
    "accountId" text,
    "sessionId" text,
    "ruleId" text,
    "sendMode" text DEFAULT 'approval-send'::text NOT NULL,
    status public."InteractionTaskStatus" DEFAULT 'QUEUED'::public."InteractionTaskStatus" NOT NULL,
    "riskLevel" text DEFAULT 'medium'::text NOT NULL,
    stage text,
    "currentTarget" text,
    "draftText" text,
    "processedCount" integer DEFAULT 0 NOT NULL,
    "failedCount" integer DEFAULT 0 NOT NULL,
    "skippedCount" integer DEFAULT 0 NOT NULL,
    "batchTargets" jsonb,
    "batchSummary" jsonb,
    events jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    config jsonb,
    "createdBy" text,
    "localTaskId" text,
    "requiresDoubleConfirmation" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    "claimedBy" text,
    "handoffReason" text,
    "handoffState" text DEFAULT 'normal'::text NOT NULL,
    "publishRecordId" text,
    "slaDueAt" timestamp(3) without time zone,
    "sourceArticleId" text,
    "sourceUrl" text
);


--
-- Name: lead_event_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_event_outbox (
    id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    consumed_at timestamp(3) without time zone
);


--
-- Name: lead_score_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_score_snapshots (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    lead_id text NOT NULL,
    fit_score integer NOT NULL,
    intent_score integer NOT NULL,
    identity_confidence integer NOT NULL,
    risk_score integer NOT NULL,
    total_score integer NOT NULL,
    confidence integer NOT NULL,
    components jsonb NOT NULL,
    reasons jsonb NOT NULL,
    evidence_ids jsonb NOT NULL,
    model_version text NOT NULL,
    rule_version text NOT NULL,
    scored_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: lead_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_signals (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    lead_id text NOT NULL,
    type text NOT NULL,
    value integer DEFAULT 1 NOT NULL,
    evidence_id text DEFAULT ''::text NOT NULL,
    source text,
    observed_at timestamp(3) without time zone NOT NULL,
    expires_at timestamp(3) without time zone,
    confidence integer DEFAULT 100 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    platform text NOT NULL,
    source_type text NOT NULL,
    source_account_id text,
    source_task_id text,
    source_run_id text,
    source_article_id text,
    source_publish_record_id text,
    source_interaction_event_id text,
    source_url text,
    source_text text,
    comment_ref text,
    video_title text,
    video_url text,
    comment_time text,
    external_user_id text,
    dedupe_key text NOT NULL,
    nickname text,
    profile_url text,
    avatar_url text,
    score integer DEFAULT 0 NOT NULL,
    score_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    matched_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    latest_reply text,
    reply_persona_id text,
    replied_at timestamp(3) without time zone,
    last_error text,
    notes jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    customer_id text,
    evidence_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    owner_user_id text,
    next_follow_up_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    enrichment_status text,
    identity_confidence integer DEFAULT 0 NOT NULL,
    missing_fields jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: local_engine_agent_confirmations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_engine_agent_confirmations (
    id text NOT NULL,
    session_id text NOT NULL,
    status text NOT NULL,
    risk_level text NOT NULL,
    confirmation_json jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT now() NOT NULL,
    decided_at timestamp(3) without time zone,
    action text NOT NULL,
    target text,
    target_label text,
    content text,
    reply_text text,
    operator text,
    note text,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL
);


--
-- Name: local_engine_agent_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_engine_agent_sessions (
    id text NOT NULL,
    source text DEFAULT 'web'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    session_json jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT now() NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    completed_at timestamp(3) without time zone,
    scope text,
    target_app text,
    instruction text,
    risk_level text,
    events jsonb DEFAULT '[]'::jsonb,
    confirmations jsonb DEFAULT '[]'::jsonb,
    evidence jsonb DEFAULT '[]'::jsonb,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL
);


--
-- Name: local_engine_reply_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_engine_reply_rules (
    id text NOT NULL,
    rule_json jsonb NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    name text,
    industry text,
    tone text,
    send_mode text,
    keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    forbidden_words jsonb DEFAULT '[]'::jsonb NOT NULL,
    highlights jsonb DEFAULT '[]'::jsonb NOT NULL,
    closing_text text,
    escalation_rules jsonb,
    enabled boolean DEFAULT true NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    bot_key text DEFAULT 'default'::text NOT NULL,
    config_version integer DEFAULT 1 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT now() NOT NULL
);


--
-- Name: materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materials (
    id text NOT NULL,
    title text NOT NULL,
    content text,
    summary text,
    source_url text NOT NULL,
    platform text NOT NULL,
    author text DEFAULT ''::text NOT NULL,
    publish_date timestamp(3) without time zone,
    collect_date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status text DEFAULT 'unmined'::text NOT NULL,
    keywords text[],
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    mining_count integer DEFAULT 0 NOT NULL,
    "hasImage" boolean DEFAULT false NOT NULL,
    image_url text,
    original_image_url text,
    owner_id text,
    tenant_id text,
    visibility text DEFAULT 'private'::text NOT NULL
);


--
-- Name: mobile_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_devices (
    id text NOT NULL,
    user_id text NOT NULL,
    device_name text NOT NULL,
    platform text DEFAULT 'android'::text NOT NULL,
    status text DEFAULT 'online'::text NOT NULL,
    last_heartbeat_at timestamp(3) without time zone,
    agent_version text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: offer_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_snapshots (
    id text NOT NULL,
    vendor_code text NOT NULL,
    platform_code text NOT NULL,
    item_id text NOT NULL,
    title text NOT NULL,
    shop_name text,
    price numeric(10,2) NOT NULL,
    coupon_amount numeric(10,2) DEFAULT 0 NOT NULL,
    pay_price numeric(10,2) NOT NULL,
    commission_rate double precision NOT NULL,
    est_commission numeric(10,2) NOT NULL,
    freight numeric(10,2) DEFAULT 0 NOT NULL,
    image_url text,
    raw_json jsonb NOT NULL,
    fetched_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    master_id text
);


--
-- Name: platform_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_identities (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    platform text NOT NULL,
    account_id text NOT NULL,
    external_user_id text,
    normalized_handle text,
    nickname text,
    profile_url text,
    avatar_hash text,
    verified boolean DEFAULT false NOT NULL,
    identity_confidence integer DEFAULT 0 NOT NULL,
    first_seen_at timestamp(3) without time zone NOT NULL,
    last_seen_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: poi_stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.poi_stores (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    category text,
    poi_id text,
    lng double precision,
    lat double precision,
    tags text,
    status text DEFAULT 'active'::text NOT NULL,
    note text,
    visit_count integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: price_histories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_histories (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    watch_id text,
    item_id text NOT NULL,
    platform_code text NOT NULL,
    title text NOT NULL,
    price numeric(10,2) NOT NULL,
    coupon_amount numeric(10,2) DEFAULT 0 NOT NULL,
    pay_price numeric(10,2) NOT NULL,
    commission_rate numeric(6,2),
    est_commission numeric(10,2) DEFAULT 0 NOT NULL,
    snapshot_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: price_watches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_watches (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    item_id text NOT NULL,
    platform_code text NOT NULL,
    title text NOT NULL,
    target_pay_price numeric(10,2),
    target_unit_price numeric(10,2),
    min_rebate numeric(10,2),
    notify_windows text,
    status text DEFAULT 'active'::text NOT NULL,
    last_notified_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL
);


--
-- Name: procurement_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_lists (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    address text,
    owner text,
    items jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    store_id text
);


--
-- Name: product_clip_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_clip_configs (
    id text NOT NULL,
    name text NOT NULL,
    product_name text NOT NULL,
    selling_points text,
    price double precision,
    audience text,
    duration_seconds integer DEFAULT 20 NOT NULL,
    image_url text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: product_masters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_masters (
    id text NOT NULL,
    name text NOT NULL,
    brand text,
    spec text,
    unit text,
    unit_qty double precision,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    title_key text NOT NULL
);


--
-- Name: publish_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publish_accounts (
    id text NOT NULL,
    platform text NOT NULL,
    name text NOT NULL,
    app_id text,
    api_token text,
    config jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    status text DEFAULT 'ready'::text NOT NULL
);


--
-- Name: publish_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publish_jobs (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    variant_id text NOT NULL,
    account_id text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    scheduled_at timestamp(3) without time zone,
    idempotency_key text NOT NULL,
    correlation_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: publish_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publish_receipts (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    job_id text NOT NULL,
    external_post_id text,
    external_url text,
    readback_state text DEFAULT 'pending'::text NOT NULL,
    readback_at timestamp(3) without time zone,
    platform_metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: publish_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publish_records (
    id text NOT NULL,
    article_id text NOT NULL,
    account_id text NOT NULL,
    platform text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    publish_url text,
    error_message text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    durable_record_id text,
    source_identity jsonb,
    body_snapshot text,
    payload_json jsonb,
    result_json jsonb,
    content_version_id text,
    correlation_id text,
    publish_intent_id text,
    readback_state text DEFAULT 'pending'::text NOT NULL
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id text NOT NULL,
    user_id text NOT NULL,
    tenant_id text,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: rebate_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rebate_accounts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    available numeric(10,2) DEFAULT 0 NOT NULL,
    pending numeric(10,2) DEFAULT 0 NOT NULL,
    frozen numeric(10,2) DEFAULT 0 NOT NULL,
    total_earned numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: rebate_exchanges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rebate_exchanges (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    rebate_amount numeric(10,2) NOT NULL,
    rate numeric(10,4) NOT NULL,
    credit_amount numeric(10,2) NOT NULL,
    status text NOT NULL,
    credit_order_no text,
    idempotency_key text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: rebate_ledgers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rebate_ledgers (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    account_id text NOT NULL,
    biz_type text NOT NULL,
    biz_no text NOT NULL,
    before_amount numeric(10,2) NOT NULL,
    change_amount numeric(10,2) NOT NULL,
    after_amount numeric(10,2) NOT NULL,
    idempotency_key text NOT NULL,
    operator text NOT NULL,
    remark text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: rebate_withdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rebate_withdrawals (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    amount numeric(10,2) NOT NULL,
    channel text NOT NULL,
    account_mask text NOT NULL,
    fee numeric(10,2) DEFAULT 0 NOT NULL,
    actual_amount numeric(10,2) NOT NULL,
    status text NOT NULL,
    external_no text,
    fail_reason text,
    idempotency_key text NOT NULL,
    reviewed_by text,
    paid_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: redfox_call_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redfox_call_logs (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    connection_id text,
    skill_id text,
    skill_code text,
    endpoint text NOT NULL,
    method text DEFAULT 'POST'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    http_status integer,
    cost_points integer DEFAULT 0 NOT NULL,
    latency_ms integer,
    retry_count integer DEFAULT 0 NOT NULL,
    request_hash text,
    request_summary jsonb,
    response_summary jsonb,
    error_code text,
    error_message text,
    started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ended_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: redfox_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redfox_connections (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    name text DEFAULT 'RedFox'::text NOT NULL,
    api_key_encrypted text NOT NULL,
    api_key_masked text,
    status text DEFAULT 'pending'::text NOT NULL,
    daily_call_limit integer,
    daily_cost_limit integer,
    last_test_at timestamp(3) without time zone,
    last_error text,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: redfox_interfaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redfox_interfaces (
    id text NOT NULL,
    platform_code text NOT NULL,
    platform_name text,
    interface_no text,
    code text NOT NULL,
    name text NOT NULL,
    path text NOT NULL,
    method text DEFAULT 'POST'::text NOT NULL,
    scenario text,
    status text DEFAULT 'online'::text NOT NULL,
    category text,
    description text,
    price double precision,
    min_price double precision,
    require_auth boolean DEFAULT true NOT NULL,
    parameters jsonb,
    examples jsonb,
    raw jsonb,
    synced_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: redfox_skill_installs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redfox_skill_installs (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    skill_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    scenario text DEFAULT 'general'::text NOT NULL,
    config jsonb,
    usage_policy jsonb,
    last_used_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: redfox_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.redfox_skills (
    id text NOT NULL,
    skill_no text,
    code text NOT NULL,
    name text NOT NULL,
    platform text,
    category text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    summary text,
    description text,
    input_schema jsonb,
    output_schema jsonb,
    status text DEFAULT 'active'::text NOT NULL,
    raw jsonb,
    synced_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: review_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_runs (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    actor_user_id text,
    period text DEFAULT '7d'::text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    funnel jsonb NOT NULL,
    insights jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    generated_from text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: risk_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_policies (
    id text NOT NULL,
    action text NOT NULL,
    risk_level text DEFAULT 'medium'::text NOT NULL,
    require_confirm boolean DEFAULT true NOT NULL,
    auto_execute boolean DEFAULT false NOT NULL,
    forbidden boolean DEFAULT false NOT NULL,
    min_plan text,
    allowed_roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    whitelist jsonb DEFAULT '[]'::jsonb NOT NULL,
    description text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: rpa_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rpa_evidence (
    id text NOT NULL,
    execution_id text NOT NULL,
    step_id text,
    tenant_id text,
    user_id text NOT NULL,
    platform text NOT NULL,
    account_id text,
    kind text DEFAULT 'rpa-step'::text NOT NULL,
    uri text,
    sha256 text NOT NULL,
    captured_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    page_url text,
    page_fingerprint text,
    source text DEFAULT 'driver'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: rpa_execution_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rpa_execution_steps (
    id text NOT NULL,
    execution_id text NOT NULL,
    sequence_no integer NOT NULL,
    step_name text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    reason_code text,
    message text,
    result_hash text,
    started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ended_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: rpa_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rpa_executions (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    platform text NOT NULL,
    session_id text,
    account_id text,
    mode text DEFAULT 'unknown'::text NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    resume_step text,
    input_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    reason_code text,
    next_action text,
    page_fingerprint text,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    driver_version text,
    run_id text,
    user_message text NOT NULL,
    technical_message text,
    started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ended_at timestamp(3) without time zone,
    source text DEFAULT 'driver'::text NOT NULL
);


--
-- Name: runtime_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_executions (
    id text NOT NULL,
    "relatedId" text NOT NULL,
    "relatedType" text NOT NULL,
    executor text NOT NULL,
    platform text NOT NULL,
    "taskType" text NOT NULL,
    "accountId" text,
    ok boolean NOT NULL,
    status text NOT NULL,
    "reasonCode" text NOT NULL,
    "userMessage" text NOT NULL,
    "technicalMessage" text,
    "runtimeJson" jsonb NOT NULL,
    "evidenceJson" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "readbackJson" jsonb,
    "agentSSessionId" text,
    "engineUrl" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    idempotency_key text,
    request_hash text,
    confirmation_id text,
    auth_session_id text,
    claim_token text,
    claimed_at timestamp(3) without time zone,
    lease_expires_at timestamp(3) without time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: savings_checkins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.savings_checkins (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    checkin_date text NOT NULL,
    reward_amount numeric(10,2) DEFAULT 0.1 NOT NULL,
    streak_day integer DEFAULT 1 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: schedule_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_configs (
    id text NOT NULL,
    task_type text NOT NULL,
    cron_expr text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    config jsonb,
    last_run_time timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL
);


--
-- Name: showcase_authorizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_authorizations (
    id text NOT NULL,
    case_id text NOT NULL,
    record_type text NOT NULL,
    grantor text,
    scope text,
    license_name text,
    source_url text,
    version_or_commit text,
    attachment text,
    valid_from timestamp(3) without time zone,
    valid_until timestamp(3) without time zone,
    review_status text DEFAULT 'pending'::text NOT NULL,
    reviewer_user_id text,
    restriction_notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: showcase_case_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_case_reviews (
    id text NOT NULL,
    case_id text NOT NULL,
    review_type text NOT NULL,
    submitted_by text,
    reviewed_by text,
    decision text DEFAULT 'pending'::text NOT NULL,
    comments text,
    changed_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: showcase_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_cases (
    id text NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    subtitle text,
    provenance_type text NOT NULL,
    client_visibility text DEFAULT 'public'::text NOT NULL,
    primary_platform text,
    platforms text[],
    primary_industry text,
    industries text[],
    capability_tags text[],
    business_problem text,
    solution_summary text,
    key_features jsonb DEFAULT '[]'::jsonb NOT NULL,
    results_summary text,
    evidence_level text DEFAULT 'E0'::text NOT NULL,
    evidence_scope text,
    delivery_modes text[],
    maturity text DEFAULT 'concept'::text NOT NULL,
    tech_summary text,
    cover_media jsonb,
    seo_title text,
    seo_description text,
    status text DEFAULT 'draft'::text NOT NULL,
    published_at timestamp(3) without time zone,
    last_reviewed_at timestamp(3) without time zone,
    next_review_at timestamp(3) without time zone,
    owner_user_id text,
    reviewer_user_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: showcase_collection_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_collection_items (
    collection_id text NOT NULL,
    case_id text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: showcase_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_collections (
    id text NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text,
    cover_media jsonb,
    visibility text DEFAULT 'public'::text NOT NULL,
    channel_code text,
    internal_customer_alias text,
    valid_until timestamp(3) without time zone,
    owner_user_id text,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: showcase_demo_endpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_demo_endpoints (
    id text NOT NULL,
    case_id text NOT NULL,
    endpoint_type text NOT NULL,
    target_url text,
    short_code text,
    allowed_devices text[],
    iframe_allowed boolean DEFAULT false NOT NULL,
    access_instruction text,
    valid_from timestamp(3) without time zone,
    valid_until timestamp(3) without time zone,
    fallback_type text NOT NULL,
    fallback_target text,
    health_status text DEFAULT 'unknown'::text NOT NULL,
    last_checked_at timestamp(3) without time zone,
    owner_user_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: showcase_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_media (
    id text NOT NULL,
    case_id text NOT NULL,
    media_type text NOT NULL,
    file_url text,
    external_url text,
    thumbnail_url text,
    title text,
    caption text,
    alt_text text NOT NULL,
    device_frame text,
    sort_order integer DEFAULT 0 NOT NULL,
    rights_status text DEFAULT 'unreviewed'::text NOT NULL,
    sensitive_reviewed boolean DEFAULT false NOT NULL,
    checksum text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: showcase_short_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_short_links (
    id text NOT NULL,
    short_code text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    target_url text,
    status text DEFAULT 'active'::text NOT NULL,
    valid_until timestamp(3) without time zone,
    channel_code text,
    open_count integer DEFAULT 0 NOT NULL,
    last_open_at timestamp(3) without time zone,
    owner_user_id text,
    case_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: showcase_tag_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_tag_aliases (
    id text NOT NULL,
    alias text NOT NULL,
    canonical_taxonomy_id text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: showcase_taxonomies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.showcase_taxonomies (
    id text NOT NULL,
    type text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: solution_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solution_artifacts (
    id text NOT NULL,
    run_id text NOT NULL,
    task_id text,
    result_id text,
    kind text NOT NULL,
    uri text,
    path text,
    mime_type text,
    size_bytes integer,
    checksum text,
    label text,
    preview jsonb,
    source text,
    object_ref jsonb,
    pii_level text DEFAULT 'none'::text NOT NULL,
    redaction_status text DEFAULT 'not_required'::text NOT NULL,
    retention_policy text,
    metadata jsonb,
    created_by text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: solution_cost_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solution_cost_entries (
    id text NOT NULL,
    run_id text NOT NULL,
    task_id text,
    provider text DEFAULT 'redfox'::text NOT NULL,
    operation text,
    skill_code text,
    endpoint text,
    estimated_cost_points integer DEFAULT 0 NOT NULL,
    authorized_cost_points integer DEFAULT 0 NOT NULL,
    captured_cost_points integer DEFAULT 0 NOT NULL,
    refunded_cost_points integer DEFAULT 0 NOT NULL,
    billing_status text DEFAULT 'estimated'::text NOT NULL,
    reservation_id text,
    transaction_id text,
    policy_version text,
    request_hash text,
    idempotency_key text,
    latency_ms integer,
    retry_count integer DEFAULT 0 NOT NULL,
    redfox_call_log_id text,
    runtime_execution_id text,
    error_code text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: solution_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solution_results (
    id text NOT NULL,
    run_id text NOT NULL,
    task_id text,
    kind text DEFAULT 'summary'::text NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    business_object_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    readback jsonb,
    quality_score integer,
    completeness integer,
    next_action text,
    failure_reason text,
    accepted_at timestamp(3) without time zone,
    approved_by text,
    payload_summary jsonb,
    raw_result_json jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: solution_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solution_runs (
    id text NOT NULL,
    tenant_id text,
    user_id text NOT NULL,
    package_code text NOT NULL,
    package_name text NOT NULL,
    package_version text DEFAULT '2026-07-01'::text NOT NULL,
    catalog_snapshot_hash text,
    trigger text DEFAULT 'manual'::text NOT NULL,
    source text DEFAULT 'solutions'::text NOT NULL,
    parent_run_id text,
    correlation_id text,
    idempotency_key text,
    status text DEFAULT 'planned'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    started_at timestamp(3) without time zone,
    ended_at timestamp(3) without time zone,
    duration_ms integer,
    error_code text,
    error_message text,
    input_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    resolved_plan_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    data_object_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    risk_level text DEFAULT 'medium'::text NOT NULL,
    confirmation_policy text DEFAULT 'manual_required'::text NOT NULL,
    send_mode text DEFAULT 'approval-send'::text NOT NULL,
    dry_run boolean DEFAULT true NOT NULL,
    estimated_cost_points integer DEFAULT 0 NOT NULL,
    max_cost_points integer DEFAULT 0 NOT NULL,
    actual_cost_points integer DEFAULT 0 NOT NULL,
    cost_status text DEFAULT 'estimated'::text NOT NULL,
    summary_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    output_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    acceptance_checks jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: solution_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solution_tasks (
    id text NOT NULL,
    run_id text NOT NULL,
    step_key text NOT NULL,
    "order" integer NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'workflow_step'::text NOT NULL,
    executor_kind text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    depends_on jsonb DEFAULT '[]'::jsonb NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 1 NOT NULL,
    retry_policy jsonb,
    queued_at timestamp(3) without time zone,
    started_at timestamp(3) without time zone,
    ended_at timestamp(3) without time zone,
    duration_ms integer,
    input_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    output_json jsonb,
    target_object text,
    reason_code text,
    error_message text,
    runtime_execution_id text,
    redfox_call_log_id text,
    interaction_task_id text,
    agent_session_id text,
    agent_confirmation_id text,
    intelligence_monitor_id text,
    dedupe_key text,
    request_hash text,
    idempotency_key text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: source_contents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_contents (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    platform text NOT NULL,
    account_id text NOT NULL,
    external_content_id text NOT NULL,
    url text NOT NULL,
    content_type text DEFAULT 'video'::text NOT NULL,
    author_identity_id text,
    title text,
    text text,
    published_at timestamp(3) without time zone,
    metrics jsonb,
    raw_hash text NOT NULL,
    collected_at timestamp(3) without time zone NOT NULL,
    expires_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sources (
    id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    url text NOT NULL,
    config jsonb,
    enabled boolean DEFAULT true NOT NULL,
    last_crawl_time timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stores (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    address text,
    owner text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: styles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.styles (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    prompt_template text NOT NULL,
    parameters jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    type text DEFAULT 'article'::text NOT NULL
);


--
-- Name: suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppressions (
    id text NOT NULL,
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL,
    kind text NOT NULL,
    normalized_value text NOT NULL,
    reason text NOT NULL,
    source_event_id text,
    created_by text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    removed_at timestamp(3) without time zone
);


--
-- Name: system_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_configs (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: system_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_logs (
    id text NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    content text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: tenant_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_entitlements (
    id text NOT NULL,
    tenant_id text NOT NULL,
    source text NOT NULL,
    plan text DEFAULT 'FREE'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    commercial_execution_allowed boolean DEFAULT false NOT NULL,
    external_subscription_id text,
    period_start timestamp(3) without time zone,
    period_end timestamp(3) without time zone,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: tenant_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_members (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    role text DEFAULT 'admin'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    joined_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    owner_user_id text NOT NULL,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: topic_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topic_materials (
    topic_id text NOT NULL,
    material_id text NOT NULL
);


--
-- Name: topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topics (
    id text NOT NULL,
    title text NOT NULL,
    description text,
    summary text,
    source_type text DEFAULT '外部采集'::text NOT NULL,
    keywords text[],
    ai_score double precision,
    score_details jsonb,
    score_reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    reasoning text,
    search_queries text[],
    tenant_id text DEFAULT 'legacy-local-desktop'::text NOT NULL,
    user_id text DEFAULT 'legacy-local-user'::text NOT NULL
);


--
-- Name: user_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_memories (
    id text NOT NULL,
    user_id text NOT NULL,
    type text DEFAULT 'episodic'::text NOT NULL,
    content text NOT NULL,
    priority integer DEFAULT 1 NOT NULL,
    scene text,
    usage_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp(3) without time zone,
    source text DEFAULT 'chat'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    last_used_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    metadata jsonb
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_login_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    username text NOT NULL,
    kaypal_user_id text,
    commercial_execution_allowed boolean DEFAULT false NOT NULL,
    plan_mode text DEFAULT 'trial'::text NOT NULL,
    role text DEFAULT 'operator'::text NOT NULL,
    avatar text
);


--
-- Name: wechat_pay_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wechat_pay_orders (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    out_trade_no text NOT NULL,
    mchid text DEFAULT '1116143786'::text NOT NULL,
    appid text,
    description text NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    transaction_id text,
    credit_points integer DEFAULT 0 NOT NULL,
    paid_at timestamp(3) without time zone,
    notify_payload jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: wecom_assistant_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wecom_assistant_integrations (
    id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    encrypted_webhook_url text NOT NULL,
    masked_webhook_url text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_tested_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: wecom_assistant_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wecom_assistant_settings (
    id text NOT NULL,
    integration_id text NOT NULL,
    user_id text NOT NULL,
    brand_name text,
    store_name text,
    reply_style text,
    transfer_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    send_to_wecom boolean DEFAULT true NOT NULL,
    auto_send_to_customer boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: wecom_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wecom_contacts (
    id text NOT NULL,
    config_id text NOT NULL,
    external_user_id text NOT NULL,
    name text DEFAULT ''::text,
    avatar text,
    type text DEFAULT ''::text,
    user_id text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: wecom_corp_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wecom_corp_configs (
    id text NOT NULL,
    user_id text NOT NULL,
    name text DEFAULT '企业微信'::text NOT NULL,
    corp_id text NOT NULL,
    encrypted_corp_secret text NOT NULL,
    agent_id text,
    status text DEFAULT 'active'::text NOT NULL,
    callback_token text,
    callback_encoding_aes_key text,
    callback_url text,
    callback_url_verified_at timestamp(3) without time zone,
    last_token_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: wecom_group_msg_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wecom_group_msg_tasks (
    id text NOT NULL,
    user_id text NOT NULL,
    config_id text NOT NULL,
    msg_type text NOT NULL,
    content jsonb NOT NULL,
    external_user_ids jsonb NOT NULL,
    sender_ids jsonb NOT NULL,
    wecom_msg_id text,
    status text DEFAULT 'creating'::text NOT NULL,
    result jsonb,
    error_message text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: wecom_moment_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wecom_moment_tasks (
    id text NOT NULL,
    user_id text NOT NULL,
    config_id text NOT NULL,
    text text,
    attachments jsonb,
    visible_range jsonb,
    wecom_job_id text,
    status text DEFAULT 'creating'::text NOT NULL,
    result jsonb,
    error_message text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: wecom_outbound_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wecom_outbound_messages (
    id text NOT NULL,
    user_id text NOT NULL,
    integration_id text NOT NULL,
    channel text DEFAULT 'wecom'::text NOT NULL,
    message_type text NOT NULL,
    content text NOT NULL,
    status text NOT NULL,
    error_message text,
    sent_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
96197d46-37be-4ab5-9a89-d74dded06520	be2814ea4b36fa458800493a5bbb16491cad7e57f7e7d9c696e366be99ee1af7	2026-08-09 13:56:39.798198+00	20260626024000_create_growth_tables	\N	\N	2026-08-09 13:56:39.774191+00	1
fcc1dd88-cbe3-4ae8-b174-62c99610f34b	14115fea2c9922930a5ddf12e7350517d8aaccbfe622f1e35e30fc22c84fafc6	2026-08-09 13:56:39.538001+00	20260225131131_init	\N	\N	2026-08-09 13:56:39.468166+00	1
0b16ce3a-50ad-46df-97b3-199b7d55da87	55cfccf056b8b0e3962679961c45529eb602567e768409d7130feefdc11df022	2026-08-09 13:56:39.637873+00	20260530140948_add_formal_local_engine_models	\N	\N	2026-08-09 13:56:39.615687+00	1
51276c85-d710-429b-9dab-ce70e79b58a8	c0fbdd7c86ee65155432ea5eefed7e83f053273f379a87da27cad8aa25af1ef6	2026-08-09 13:56:39.544159+00	20260227132856_init	\N	\N	2026-08-09 13:56:39.538571+00	1
5b90fd3b-d024-45d8-8a22-144d0ab53083	e084cd462b33fdca61464a14e67f701e298396a455192b87cd67706a366ae044	2026-08-09 13:56:39.54739+00	20260227152902_add_mining_count	\N	\N	2026-08-09 13:56:39.544759+00	1
57fc8add-0e59-46cc-a2b0-a19177117c04	2a2865a995afcef34604583a650aa21b7be58b97d9580de9fef435c04a030111	2026-08-09 13:56:39.710222+00	20260625090000_add_crm_market_app	\N	\N	2026-08-09 13:56:39.693083+00	1
9202a54a-fb16-466a-ba72-e594b3fbe150	bf70396bfb13ee49a6340ba5056404bc2665cde636482e39d5474566a46804b1	2026-08-09 13:56:39.55188+00	20260311015000_add_html_article_fields	\N	\N	2026-08-09 13:56:39.547981+00	1
849de614-4361-4378-a353-66790627ede8	96e276b27259381f3210a04446fd1904d6de67fffe3d7a18f9c5102679812289	2026-08-09 13:56:39.642614+00	20260601010300_add_wechat_channel_interaction_tasks	\N	\N	2026-08-09 13:56:39.638424+00	1
1281c138-ba6d-4fbf-813b-7abd5dfd502f	b9c4c938199bb5e19d578874079b5c1e404682be59da944bebf0110f23d2b5c6	2026-08-09 13:56:39.554754+00	20260312093000_add_article_content_type	\N	\N	2026-08-09 13:56:39.552441+00	1
80969fd1-1ad7-49e8-9caa-4ee974f48309	de2800c0ea0bf1ec51f0ec09cafd9e07affd8fda70b531efa6bad0c1b0bb7156	2026-08-09 13:56:39.557008+00	20260312101000_add_xiaohongshu_data	\N	\N	2026-08-09 13:56:39.555394+00	1
c8c3c2db-e462-4c77-ad2e-95352ce55022	043ae4fcb215795e5b6778f54090df9ec1545f1a8dcf1cbfcb32079289685f81	2026-08-09 13:56:39.56486+00	20260317000000_add_auth_tables	\N	\N	2026-08-09 13:56:39.557558+00	1
0aefbe63-9088-434a-9845-2d7144a1237f	8e07c220cb193f198d0482d4ecd580d663375a3b6dd64be2c2869f96ae331a26	2026-08-09 13:56:39.646099+00	20260602120000_add_kaypal_user_id	\N	\N	2026-08-09 13:56:39.643236+00	1
0bf1c0e4-4013-4602-afea-a84767a8022d	a7b1fffdc70f7a249c3ded7a01a9913305ee9dad67d3a7ba76a9861e5784add4	2026-08-09 13:56:39.568776+00	20260317003000_add_username_to_users	\N	\N	2026-08-09 13:56:39.565496+00	1
774f2489-5afa-4c31-96a2-791751a831d9	dad4697f9f18d718f03bbc9b97c150c7727a24196eb72af97add3ef28f051ec0	2026-08-09 13:56:39.574811+00	20260319000000_add_content_strategies	\N	\N	2026-08-09 13:56:39.569359+00	1
7299308e-11b3-42b3-baad-58fd02ae8d35	21a97c416b61f3ad7b8e07fa813982b58b2dbffa7e03f5a262384917dd22db48	2026-08-09 13:56:39.587946+00	20260320133000_add_schedule_publish_and_material_image_fields	\N	\N	2026-08-09 13:56:39.57614+00	1
773fed3a-8589-4744-88ff-0f343669da7f	ec88f6576397e0a1f37fe12b9c6d969c5f3bdec81598d0040180de1ec17d7316	2026-08-09 13:56:39.659574+00	20260603093000_align_risk_policy_columns	\N	\N	2026-08-09 13:56:39.646694+00	1
5f80eced-e238-4496-afcc-e880407a347f	c818fdc6f231fd8ecb0398850a27892e18ae01895591d740247bfea1f6820914	2026-08-09 13:56:39.596899+00	20260530021500_add_geo_bridge_tasks	\N	\N	2026-08-09 13:56:39.588633+00	1
ea76abf6-9819-4b95-b3a4-6c3bd0c36127	0f46454c5a2ef38c695706eb97591e79cf1fa65aa8637edd29a4fa84ab74df47	2026-08-09 13:56:39.61275+00	20260530033000_add_local_engine_tables	\N	\N	2026-08-09 13:56:39.598236+00	1
bbe5f4a1-53f5-4037-8873-315fc4b87c85	8591310b7abf04c2791cf2a3e89c7aa201c51f4f84dc8dc9f6d01b37b2eeb84b	2026-08-09 13:56:39.742081+00	20260625103000_add_crm_lite_p0	\N	\N	2026-08-09 13:56:39.710919+00	1
6d0bd58a-bc95-4129-ab8e-4f1611f81099	7ef58e598cb4c6281d154eebdb5aac9f49ddeee0a3658d08966cb9667d4f2916	2026-08-09 13:56:39.61502+00	20260530120000_add_session_metadata	\N	\N	2026-08-09 13:56:39.613347+00	1
d92b7ae4-839a-479c-a9f8-a5ab8394238f	3faa83ccbafedb1d1f277e61b5444c1164eb86b9db5d06e3402f65d94eb0b7c2	2026-08-09 13:56:39.668228+00	20260603170000_add_runtime_executions	\N	\N	2026-08-09 13:56:39.660342+00	1
8fd332fd-84d8-4095-b76b-71127c504345	96f6846e33e35989e6bd94c7c4916bd3160d4c8460b70a9499bcea216d820f99	2026-08-09 13:56:39.675676+00	20260604040000_runtime_executions_accountid_text	\N	\N	2026-08-09 13:56:39.668819+00	1
1d0acb63-2a90-4dea-8d6a-2e2e9b8065b1	ffad48b0415044b4308015562401f4a5f5cafe28af07f6d1bccde6c11ace5161	2026-08-09 13:56:39.896491+00	20260701051500_repair_local_engine_confirmations	\N	\N	2026-08-09 13:56:39.894543+00	1
c702a507-47aa-431d-a5a0-5197d62b69b6	9ae750966834347ac44eec048dcbce4f323744d249045f34677a00a24c499359	2026-08-09 13:56:39.689178+00	20260612214500_add_wecom_assistant	\N	\N	2026-08-09 13:56:39.677006+00	1
02c3acfb-3b9b-4feb-968f-abafeb5b02c9	ee58cd401648b59495f449b6b043ed826d345b699a41f79970701b3d9a20d7a9	2026-08-09 13:56:39.759427+00	20260626005000_add_tenants_entitlements	\N	\N	2026-08-09 13:56:39.742799+00	1
a4b0f918-6dad-4a65-a36c-86635fb69c30	ba69af8aa519676473828620ca09601c605acb5fcb3e9f0e95e815063f4a198e	2026-08-09 13:56:39.692395+00	20260613133000_add_ai_employee_desktop_task_types	\N	\N	2026-08-09 13:56:39.689831+00	1
433ea3db-0e0d-4227-ac3f-274aeab0ac6d	657f1d0923c9ed455f599996d19dea3fe63ad5c3c1f8b6e2cdb6cd06dd605f08	2026-08-09 13:56:39.80358+00	20260626025000_growth_tenant_scope	\N	\N	2026-08-09 13:56:39.798894+00	1
a697ac72-fc8c-46c3-bf38-f66c63043ca7	76f4c3bddcc3745c3ef19545738aab2891561010be242a1e14c0cd544ee30e4c	2026-08-09 13:56:39.764372+00	20260626012000_app_market_tenant_scope	\N	\N	2026-08-09 13:56:39.76001+00	1
7fcced83-c83e-4e04-b3a2-3c985b4f0161	33277afc6f7e7df22ed0fffd234cb60232313de54b2d742f95a5f4298453d7b4	2026-08-09 13:56:39.773404+00	20260626021000_crm_tenant_scope	\N	\N	2026-08-09 13:56:39.765045+00	1
5bc19e4d-f215-4107-a6fa-6d05da60dd80	df73b7276c046012168db0c07845d1a06e34a6bfb9f36a7f088a28c1afcb0c38	2026-08-09 13:56:39.881487+00	20260630093000_add_intelligence_reports	\N	\N	2026-08-09 13:56:39.874744+00	1
37e31572-cd9a-4710-a31a-afb70c070e60	5ac9dd2656088bd5c1c1f95dc31a510123fcce5656140e9a1099cbb32b31c4bc	2026-08-09 13:56:39.810146+00	20260626033000_growth_scheduler_leases	\N	\N	2026-08-09 13:56:39.804203+00	1
5e7dfd93-6eda-4ecc-a60b-3f4efcdc4a3c	b9d969b7e085fd69a508531d70ea3d708b91f5ffdc0b7103deb3f8c1785c72c1	2026-08-09 13:56:39.894017+00	20260701050000_repair_local_engine_columns	\N	\N	2026-08-09 13:56:39.89168+00	1
22c490b6-0a0c-4de9-a738-8b0c91771510	7632a76ad1a77be128867bc8ed7db4d76fc37eb375cde0ea75e4c7473a5c72e9	2026-08-09 13:56:39.874105+00	20260629001000_add_redfox_intelligence_foundation	\N	\N	2026-08-09 13:56:39.810825+00	1
ae624146-5048-483b-a3f2-d9be94b3971e	de1308d5a0d05846b7370bb00221424ac073738cff20a40b0e82c6b39f6b53d7	2026-08-09 13:56:39.891081+00	20260630143000_add_redfox_interfaces	\N	\N	2026-08-09 13:56:39.883254+00	1
f04e5623-a37f-4984-9fc6-08458232dabf	5965835b16f5cd12f257d8defec44d2e8eee36a03fd908a0e118fd1b9451a2c4	2026-08-09 13:56:39.931832+00	20260701070000_add_solution_runs	\N	\N	2026-08-09 13:56:39.897217+00	1
980cbe65-7fcb-4259-aaf9-49c34c9b8475	42649f1a89f96141ecd0c090d1385606d701c784f1fdbfbfffe636b53b85d605	2026-08-09 13:56:39.948166+00	20260701083000_add_crm_import_audit	\N	\N	2026-08-09 13:56:39.93249+00	1
561cbaee-1c37-4daa-8309-55948cf9ccbb	e70b43eedb6833304d96edcba0437fe69705df85585f0c55bc55da553aec637b	2026-08-09 13:56:39.962728+00	20260701120000_add_billing_webhook_entitlements	\N	\N	2026-08-09 13:56:39.948791+00	1
53210249-e3b5-4800-91b8-731c6ff6357f	60ff0a0852912c726bef9a8559738ad5c8536a4299e0ac1c8aceb7123d7ebed9	2026-08-09 13:56:39.971203+00	20260701133000_add_billing_invoice_audit	\N	\N	2026-08-09 13:56:39.963291+00	1
49c585ec-e8f5-489c-ade8-de42e97822ac	60719300a0c07294a241921e65e7e52753f48f71a058218d429fb9549e1101b6	2026-08-09 13:56:39.996787+00	20260703090000_content_optimization_commercial_closure	\N	\N	2026-08-09 13:56:39.971823+00	1
63c0e5b2-e0fd-4bf5-83db-1f72084aca31	6092dc9f21e8dadba252ec48495d437794dcf2edd7000438f2b3ac9e347f2d88	2026-08-09 13:56:40.006366+00	20260703103000_add_crm_connector_vault	\N	\N	2026-08-09 13:56:39.997404+00	1
82fcbbdc-1d44-48b6-b321-b4f20c45065e	a5a8522aa05a68d4a752153e99c7fe0b93931604bab000e03ed97a772d208679	2026-08-09 13:56:40.08716+00	20260808110000_add_growth_account_health_snapshot	\N	\N	2026-08-09 13:56:40.081888+00	1
cd82c6fc-be68-41e4-904a-08df26f08e01	e6326d2b0b95e063e3d5083598bfa4619a19b67e1b0ec7d79d24759f638a2e0b	2026-08-09 13:56:40.020036+00	20260710120000_local_engine_tenant_scope	\N	\N	2026-08-09 13:56:40.00821+00	1
6ca5a57a-84b4-4dff-a4e1-c98068e9976b	b0e1ee83f49c497b32fd7a24366feaf54f3ca79125b1e09a0ba307ffe5c4a12c	2026-08-09 13:56:40.02462+00	20260711123000_runtime_execution_tenant_scope	\N	\N	2026-08-09 13:56:40.020631+00	1
a5bbf207-9c81-44da-9e59-491bdeaee3ed	89221e4cbb03d0e45ad5b5ccd5df3873927ca3c56a053eac41322a9451c9f513	2026-08-09 13:56:40.030974+00	20260711170000_article_publish_ownership	\N	\N	2026-08-09 13:56:40.025218+00	1
e6560e5e-f5a5-4ba0-bc6e-439134a50a7c	ef8a34acf752e3a314440d3e23b99ea3247a4ddeacd55e9522efb5bbb52dfcb7	2026-08-09 13:56:55.997219+00	20260809135650_add_content_strategy_templates	\N	\N	2026-08-09 13:56:55.967412+00	1
2b816187-0eed-4e23-8ebe-b5066a8b1cea	2c104e0c7e4e9473677707e0858440963d27ff4eaf6805b15cce98317b0fec0c	2026-08-09 13:56:40.034878+00	20260720123000_add_article_wechat_data	\N	\N	2026-08-09 13:56:40.032994+00	1
bef14d5e-77a3-4edf-8265-f3f624c357fd	aee8cdb34421ab2d5f23e38d1fce3d6450419ef9e2ac9e213094aeb131d949f4	2026-08-09 13:56:40.037352+00	20260722090000_add_content_workspace_foundation	\N	\N	2026-08-09 13:56:40.035408+00	1
37b4378c-df62-4ae6-acff-9a456f0a1f3d	044ff2159d977e6cacda3d1b2c1cbf0ca803ea2c176cb83da138729f875b4949	2026-08-09 13:56:40.041856+00	20260801160000_add_runtime_execution_durable_claims	\N	\N	2026-08-09 13:56:40.03787+00	1
1e7e28e2-3594-4397-892a-a4b71146e298	059ef7c9061f1f1bfc723330f2cbd6de0a1f8865916c00b80f4a2fc582fa7b5e	2026-08-09 15:44:21.099176+00	20260809154414_add_savings_module	\N	\N	2026-08-09 15:44:21.035294+00	1
49decab9-eb21-48ef-a854-cc3990f06dee	52c0b19ebfceb4a62501d7459cd2935d6bbf7f108ad18d98907bfcf64664ab2a	2026-08-09 13:56:40.046937+00	20260804000000_push_subscriptions	\N	\N	2026-08-09 13:56:40.042393+00	1
fae7b27b-c933-478f-aecd-b1615bed3061	ae56c56ba08eb8128e1e9f609f631808c4b125ee67e1ee1fc97d93f52af49f79	2026-08-09 13:56:40.053448+00	20260805160000_add_brand_knowledge	\N	\N	2026-08-09 13:56:40.048203+00	1
9fd0f129-ea10-41cc-a2ca-3c7e95b2dc18	6a4567208723057d731dd05bb64605ce7bbc1fabe1ba6c31ec12e65302f06992	2026-08-09 13:56:40.05828+00	20260806120000_add_account_subscription	\N	\N	2026-08-09 13:56:40.05407+00	1
bbe1e30e-1b25-4472-9665-7f531df61e8a	a80689b55774809b5b10f3c59431660abfef406e86afabcb7eaa820b9b998412	2026-08-09 16:12:15.10522+00	20260809161212_add_ai_credit_account	\N	\N	2026-08-09 16:12:15.08559+00	1
ca64f107-f2dc-4860-9304-94a5349c28b9	04e448895d9a0a96503d21ceb2009a5f9405aab98280079f72aa30ff9a157c83	2026-08-09 13:56:40.064651+00	20260806130000_add_user_memory	\N	\N	2026-08-09 13:56:40.058917+00	1
5e48b1bb-5a37-481e-9d7f-4c29a6bcf8ae	fc0abc526a80d65ea6d9d24afa7a76072ce7dd063bf78a54a531710359c100db	2026-08-09 13:56:40.073685+00	20260806140000_add_ai_audit_quota	\N	\N	2026-08-09 13:56:40.065271+00	1
88347cf2-b559-4f0e-aac0-f958f7145b30	f0ea6a1582159abd4f4be91887c4c62eb9af3d9fdb33090e6167795504f4f9dc	2026-08-09 13:56:40.081043+00	20260806150000_add_mobile_executor	\N	\N	2026-08-09 13:56:40.075281+00	1
808ade74-430a-4a8f-8cde-64c33e09534c	4d0f117fa39bee297c078c763d9f7aec25c7ad9ce9bb831c73d68b6f827996ab	2026-08-09 19:42:35.182989+00	20260809180000_add_client_config	\N	\N	2026-08-09 19:42:35.174483+00	1
6ba7a90f-ed5b-40b0-b619-9655dfdb9f66	c3894cd87a83446a5512d2ceace36f9662bb32782ea986a225ce86e7cc6b8600	\N	20260809124358_add_sku_master_link	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260809124358_add_sku_master_link\n\nDatabase error code: 42601\n\nDatabase error:\nERROR: syntax error at or near "Error"\n\nPosition:\n[1m  0[0m\n[1m  1[1;31m Error: [0m\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42601), message: "syntax error at or near \\"Error\\"", detail: None, hint: None, position: Some(Original(1)), where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("scan.l"), line: Some(1188), routine: Some("scanner_yyerror") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260809124358_add_sku_master_link"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260809124358_add_sku_master_link"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:260	2026-08-09 19:44:43.535134+00	2026-08-09 19:44:07.819341+00	0
c11ba32b-3aff-4835-9520-cbd13b81b31c	7a8f7dc8d4a9dd53a4bbba0071624f29999902eb8ed5706796db34a7ded44b3c	2026-08-09 19:44:43.537362+00	20260809124358_add_sku_master_link		\N	2026-08-09 19:44:43.537362+00	0
93c21187-57fd-4389-8d24-53e3167f5ca2	e0f5b524b3bef9823a7d540ca1992b0a8527e4eed517c7ea8c6e5cd3d62c8dbc	2026-08-09 19:50:08.128189+00	20260809125000_add_stores		\N	2026-08-09 19:50:08.128189+00	0
f212ea84-8a7d-4909-8921-2380917e8204	eb00592221ca862937ef9c8fb96e57e273c787745719a9c843814fd4b24ff5f6	2026-08-09 20:33:28.931259+00	20260809133300_add_price_history		\N	2026-08-09 20:33:28.931259+00	0
026e459a-93f8-4bda-b491-2bb29ea8aba6	675810c71df077340756d8b3156d14377298ae9fb84b01e3465854c8634c6f74	2026-08-09 21:42:19.895645+00	20260809144218_add_favorites_checkin		\N	2026-08-09 21:42:19.895645+00	0
03ef9c29-2644-4505-bac8-624a3ee267d8	04366e93b98576385749610371dd10c06643413dbb8a915f6dab4c38c77ade47	\N	20260812193905_add_leads	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260812193905_add_leads\n\nDatabase error code: 42P07\n\nDatabase error:\nERROR: relation "leads" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42P07), message: "relation \\"leads\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("heap.c"), line: Some(1164), routine: Some("heap_create_with_catalog") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260812193905_add_leads"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260812193905_add_leads"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:260	2026-08-18 18:47:05.586941+00	2026-08-18 00:58:28.151025+00	0
ddc392b7-8834-4174-8236-90796fc720c4	04366e93b98576385749610371dd10c06643413dbb8a915f6dab4c38c77ade47	2026-08-18 18:47:05.588779+00	20260812193905_add_leads		\N	2026-08-18 18:47:05.588779+00	0
ca6d61bb-f390-4737-9a94-6d5ae4ee0e7f	6d98cf7444fa5487f9e6d2e9548dfd9d4b7013c4cbd3e2b778ec1c750327a3b1	2026-08-18 18:47:06.161741+00	20260812200615_add_leads_comment_ref		\N	2026-08-18 18:47:06.161741+00	0
d5e8ce52-c5d4-4b66-9031-1e0673d6beaf	9b745c2cc604205a298566ca7523d9c2ca49fbc911664202544a7a169bde0191	2026-08-18 18:47:06.742844+00	20260812201637_add_leads_account_error		\N	2026-08-18 18:47:06.742844+00	0
8540e4c3-04b6-40f0-982d-0681983185a5	d58cf15fca014e6b7833ae46529914f51f97cc6665d5eb67a74c5fd9f8a9f217	2026-08-18 18:47:07.324159+00	20260812202923_add_leads_growth_fields		\N	2026-08-18 18:47:07.324159+00	0
21fac5c2-a63d-4f75-8a9d-716ad4d19db9	ad59cf6aea87cb12f168e051ce6fa38449a33839171bc26a9502d2fad37bf9d0	2026-08-18 18:47:07.927243+00	20260812205000_add_ai_call_traces		\N	2026-08-18 18:47:07.927243+00	0
c7911295-4ede-457d-b6ce-fe44a38867c3	61a0aa1205ec19523a8da2a06dbaa6278f0f4b672fad782100fbd253d90bd7d0	2026-08-18 18:47:08.52324+00	20260813042740_add_actor_user_id		\N	2026-08-18 18:47:08.52324+00	0
9c3ab8fe-f294-4475-9993-21e3e8e35190	6c05b07cedc3a296a2779c4db1e05a8e14b86e7ceff7af1223410d458cb9b52f	2026-08-18 18:47:09.104026+00	20260817180000_add_identity_merge_audit		\N	2026-08-18 18:47:09.104026+00	0
e47f6818-d207-4f80-9876-c8b432f74efa	24f50f2f01581a5989da2c712542333a4b13c636bbb08c30a7127714ac26337b	2026-08-18 18:47:09.739945+00	20260818120000_create_case_showcase	\N	\N	2026-08-18 18:47:09.687534+00	1
b06d37e4-35af-4115-aac6-8d94f1fd79c3	b2137fdbd5b3878daf8860a1ce6c71a1062b83d5a7ba0998ab8449fc504aebe4	\N	20260819153000_add_rpa_fields	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260819153000_add_rpa_fields\n\nDatabase error code: 42P01\n\nDatabase error:\nERROR: relation "rpa_executions" does not exist\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42P01), message: "relation \\"rpa_executions\\" does not exist", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("namespace.c"), line: Some(433), routine: Some("RangeVarGetRelidExtended") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260819153000_add_rpa_fields"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260819153000_add_rpa_fields"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:260	2026-08-19 18:38:09.00013+00	2026-08-19 18:37:07.204958+00	0
1b8cdc4c-f8a5-4d6a-8885-3d262c546efe	9fd205fce9c53c087064638de47a9429469c0f2559598cc40b105365690e2254	2026-08-19 20:41:58.063442+00	20260819134000_rpa_execution_source	\N	\N	2026-08-19 20:41:58.059229+00	1
c673905a-7771-4ffe-9836-47abb93a816d	e44eb64b85d91bc6688860bf6e19cb50a0c22b994a2dd24e030e1e34c863b7f2	2026-08-19 18:38:09.572054+00	20260819153000_add_rpa_fields	\N	\N	2026-08-19 18:38:09.547402+00	1
471787e3-6d13-4c7e-9b30-6cc363faa5ea	6c6fb426b20b15ee55f20a65c3f3dbe7d4e88e0f5daaa6ddb4a3b35b49006dc4	2026-08-19 18:38:09.577275+00	20260819200000_rpa_evidence_step_fk	\N	\N	2026-08-19 18:38:09.572821+00	1
4205a962-f46b-4c44-a4e4-146b7f74da55	7ee145a0738b4de5d3263235d473355666cf2e56ef7759926ce56052f2185e4e	2026-08-19 20:28:41.750653+00	20260819133000_p111_lead_enrichment_fields	\N	\N	2026-08-19 20:28:41.746178+00	1
72ba9fe7-7e10-4f60-9dbf-8d18d0049c35	d94787ce3c8fb4ae5d0eaf46bbbc210455f65118591f570a4a7e2e6ecb2f425f	\N	20260819140000_rpa_evidence_sha256_composite	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260819140000_rpa_evidence_sha256_composite\n\nDatabase error code: 2BP01\n\nDatabase error:\nERROR: cannot drop index rpa_evidence_sha256_key because constraint rpa_evidence_sha256_key on table rpa_evidence requires it\nHINT: You can drop constraint rpa_evidence_sha256_key on table rpa_evidence instead.\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E2BP01), message: "cannot drop index rpa_evidence_sha256_key because constraint rpa_evidence_sha256_key on table rpa_evidence requires it", detail: None, hint: Some("You can drop constraint rpa_evidence_sha256_key on table rpa_evidence instead."), position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("dependency.c"), line: Some(835), routine: Some("findDependentObjects") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260819140000_rpa_evidence_sha256_composite"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260819140000_rpa_evidence_sha256_composite"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:260	2026-08-19 21:40:36.043561+00	2026-08-19 21:40:18.695915+00	0
8b79c631-d385-46b7-bc00-90eed4286c56	b146a39c390edde27f87e28b5c76d50c850b57f0d40b262ac1deb869b2f587c2	2026-08-19 21:40:36.047146+00	20260819140000_rpa_evidence_sha256_composite		\N	2026-08-19 21:40:36.047146+00	0
069646eb-d204-4643-8e0c-c961c619525d	ed266cd4f4b73eacd413296f930451c792e8f1da9f0fe88bb6bdd7042682c063	2026-08-19 23:32:08.818809+00	20260819210000_repair_sku_master_link_order	\N	\N	2026-08-19 23:32:08.810715+00	1
b94c17c6-6ee9-4b2d-a276-7da2562f9882	d8abfb1cecac41e10762e1e57a7c06b0caab1f5e21a1dd36dd42ecc7ca89593e	2026-08-21 05:54:53.687815+00	20260820220000_p2_crm_customer_attribution_columns	\N	\N	2026-08-21 05:54:53.676146+00	1
f9ac8c4c-ff98-4173-bc1b-0c09cf1f50a4	0256172113b000bc3bee43981c683b55be0382c3076c1cdda79efc4916ce4cbf	2026-08-22 00:34:36.219801+00	20260821180000_p3_growth_task_draft	\N	\N	2026-08-22 00:34:36.203707+00	1
\.


--
-- Data for Name: account_subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.account_subscriptions (id, tenant_id, user_id, platform, account_id, account_name, account_url, active, last_fetched_at, last_snapshot, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: acquisition_quotas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.acquisition_quotas (id, user_id, date, discover_count, discover_limit, updated_at) FROM stdin;
\.


--
-- Data for Name: activation_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.activation_events (id, user_id, tenant_id, event_type, ref_id, created_at) FROM stdin;
\.


--
-- Data for Name: ai_call_traces; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_call_traces (id, user_id, tenant_id, scene, model_id, model_name, prompt_json, completion, prompt_tokens, completion_tokens, total_tokens, latency_ms, success, error_msg, created_at) FROM stdin;
\.


--
-- Data for Name: ai_chat_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_chat_logs (id, user_id, session_id, model, platform, messages, tool_calls, status, error_msg, duration_ms, created_at) FROM stdin;
cmt3pwe4f002m31rd433dqj0v	cms2ktllp03u9j1wprksvwy8w	\N	deepseek-v4-flash	Kaypal 模型台	3	0	ok	\N	19894	2026-08-22 01:46:38.079
cmt3que0800hx313s2a0ffygt	cms2ktllp03u9j1wprksvwy8w	\N	deepseek-v4-flash	Kaypal 模型台	5	0	ok	\N	6827	2026-08-22 02:13:04.233
cmt3qur7n00lh313su1f59ubg	cms2ktllp03u9j1wprksvwy8w	\N	deepseek-v4-flash	Kaypal 模型台	7	0	ok	\N	5807	2026-08-22 02:13:21.348
cmt3ra3wy00bf313v7ma65oac	cms2ktllp03u9j1wprksvwy8w	\N	deepseek-v4-flash	Kaypal 模型台	9	0	ok	\N	2518	2026-08-22 02:25:17.65
\.


--
-- Data for Name: ai_credit_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_credit_accounts (id, tenant_id, user_id, balance, total_granted, total_consumed, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: ai_models; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_models (id, name, model_id, platform_id, enabled, config, created_at, updated_at) FROM stdin;
cmsxx1o6h0005jfti6zsrlzye	Kaypal 默认模型 / deepseek-v4-flash	deepseek-v4-flash	cmsxx1o6d0003jftix16tgxt7	t	{"source": "kaypal", "syncedAt": "2026-08-18T00:20:04.648Z", "kaypalProviderId": "kaypal"}	2026-08-18 00:20:04.649	2026-08-18 00:20:04.649
\.


--
-- Data for Name: ai_platforms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_platforms (id, name, base_url, api_key, enabled, config, created_at, updated_at) FROM stdin;
cmsxx1o6d0003jftix16tgxt7	Kaypal 模型台	https://kaypal.cn/api/ai	kaypalcred_a138ae01e7b0c3675a2495b3d9af5ee90d212f15a8e13864	t	{"source": "kaypal", "syncedAt": "2026-08-18T00:20:04.645Z", "authSource": "api-key", "defaultHeaders": {"x-kaypal-api-key": "kaypalcred_a138ae01e7b0c3675a2495b3d9af5ee90d212f15a8e13864"}, "kaypalProviderId": "kaypal", "kaypalProviderName": "Kaypal 默认模型", "kaypalProviderType": "kaypal-proxy"}	2026-08-18 00:20:04.645	2026-08-18 00:20:04.645
\.


--
-- Data for Name: ai_tool_call_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_tool_call_logs (id, user_id, tool, args_json, result_ok, error_msg, duration_ms, confirmed, created_at, tokens_used, cost_points) FROM stdin;
\.


--
-- Data for Name: ai_usage_quotas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_usage_quotas (id, user_id, date, chat_count, tool_count, chat_limit, tool_limit, updated_at, token_count, token_limit) FROM stdin;
cmt3pwe4i002n31rdebbwszxa	cms2ktllp03u9j1wprksvwy8w	2026-08-21	4	0	50	100	2026-08-22 02:25:17.656	0	2000000
\.


--
-- Data for Name: app_install_states; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_install_states (id, user_id, app_key, purchase_status, install_status, entitlement_snapshot, settings, purchased_at, installed_at, uninstalled_at, created_at, updated_at, tenant_id, actor_user_id) FROM stdin;
\.


--
-- Data for Name: approvals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.approvals (id, tenant_id, user_id, action_id, action_type, risk_level, input_hash, affected_lead_ids, excluded_lead_ids, approver_id, status, reason, created_at, expires_at, applied_at) FROM stdin;
\.


--
-- Data for Name: articles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.articles (id, topic_id, title, content, style_id, model_id, status, created_at, updated_at, cover_image, content_format, raw_html, final_html, template_id, content_type, xiaohongshu_data, tenant_id, user_id, wechat_data, workspace_brief, workspace_outline, workspace_step, workspace_revision, parent_id) FROM stdin;
\.


--
-- Data for Name: attribution_links; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.attribution_links (id, tenant_id, user_id, from_type, from_id, to_type, to_id, model, confidence, label, evidence, created_at) FROM stdin;
cmt2sggpc09ii31wmf6mzleui	cmt2qp30c01mm31wm61euoou6	usr_test_qa	customer	cmt2sgadz09gy31wmln42wnmp	opportunity	cmt2sgagq09he31wm8bdgylk6	deterministic	high	won_by	{"wonAt": "2026-08-21T10:10:27.600Z", "amountCents": 1280000}	2026-08-21 10:10:27.601
cmt2ytt9f004w316g84tstzm7	cmt2qp30c01mm31wm61euoou6	usr_test_qa	customer	cmt2ytt3x003i316gr6ko8rpi	opportunity	cmt2ytt5s003y316g15umd3dx	deterministic	high	won_by	{"wonAt": "2026-08-21T13:08:48.098Z", "amountCents": 880000}	2026-08-21 13:08:48.099
\.


--
-- Data for Name: benchmark_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.benchmark_accounts (id, tenant_id, user_id, intelligence_item_id, growth_lead_id, platform, nickname, external_user_id, profile_url, avatar_url, metrics, reason, diagnosis, status, raw, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: billing_invoices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.billing_invoices (id, tenant_id, provider, external_invoice_id, external_customer_id, external_subscription_id, status, amount_due, amount_paid, currency, hosted_invoice_url, invoice_pdf_url, attempted_at, paid_at, failed_at, latest_webhook_event_id, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: billing_subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.billing_subscriptions (id, tenant_id, provider, external_customer_id, external_subscription_id, plan, status, current_period_start, current_period_end, cancel_at_period_end, latest_webhook_event_id, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: billing_webhook_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.billing_webhook_events (id, provider, event_id, event_type, tenant_id, external_customer_id, external_subscription_id, signature_verified, status, error_message, processed_at, payload, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: boss_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.boss_accounts (id, user_id, name, storage_state_path, last_checked_at, created_at, updated_at, login_status) FROM stdin;
\.


--
-- Data for Name: boss_candidates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.boss_candidates (id, user_id, account_id, name, job_title, wechat_id, status, notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: boss_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.boss_tasks (id, user_id, account_id, task_type, status, result, error_message, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: brand_knowledge; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.brand_knowledge (id, tenant_id, user_id, title, content, type, tags, source, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: client_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.client_configs (key, value, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: comment_insights; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.comment_insights (id, tenant_id, user_id, intelligence_item_id, growth_lead_id, redfox_call_log_id, platform, source_url, source_external_id, pain_points, intent_keywords, demand_signals, objections, reply_suggestions, raw, analyzed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: compliance_checks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.compliance_checks (id, tenant_id, user_id, material_id, topic_id, redfox_call_log_id, target_type, target_id, platform, risk_level, status, findings, suggestions, raw, checked_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: content_asset_versions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_asset_versions (id, tenant_id, asset_type, asset_id, version_no, snapshot, change_summary, actor_user_id, created_at) FROM stdin;
\.


--
-- Data for Name: content_drafts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_drafts (id, tenant_id, user_id, source_type, source_id, title, content, platform, target_type, status, official_version_id, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: content_evidence_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_evidence_logs (id, tenant_id, user_id, target_type, target_id, action, snapshot, created_at) FROM stdin;
\.


--
-- Data for Name: content_manual_reviews; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_manual_reviews (id, version_id, tenant_id, user_id, risk_level, note, reviewer_name, created_at) FROM stdin;
\.


--
-- Data for Name: content_optimization_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_optimization_runs (id, draft_id, tenant_id, user_id, mode, platform, input, result, source_workflow_id, source_summary, cost_points, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: content_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_plans (id, tenant_id, user_id, actor_user_id, name, goal, audience, core_claim, offer, platforms, success_metric, evidence_refs, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: content_publish_feedback; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_publish_feedback (id, version_id, publish_intent_id, tenant_id, user_id, platform, views, likes, comments, saves, leads, note, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: content_publish_intents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_publish_intents (id, version_id, tenant_id, user_id, platform, title, content, status, scheduled_at, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: content_strategies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_strategies (id, name, description, industry, target_audience, commercial_goal, core_pain_points, writing_angles, tone_and_style, is_default, enabled, created_at, updated_at) FROM stdin;
cmslvaokk0000i5ajkmrdbaru	美业内容策略	面向美容/美发/美甲/医美/SPA 门店的内容创作策略	美业	25-45 岁注重形象与自我投资的女性，本地消费为主，关注皮肤/身材/发型管理，决策受小红书种草与朋友圈口碑影响	新客到店体验 → 会员办卡 → 周期复购，建立「专业+懂我」的门店信任	怕被强推销、怕效果夸大失望、怕卫生与安全不达标、价格不透明、怕做完变丑（决策焦虑）	真实效果对比、客户变美故事、专业知识科普（破除误区）、项目避坑指南、限时福利活动、门店环境与卫生展示	亲切专业、像闺蜜推荐而非销售话术、少套路多真诚、用真实案例说话、避免夸大承诺（尤其医美需合规）	f	t	2026-08-09 13:57:51.716	2026-08-09 14:33:02.208
cmslvaokn0001i5ajusdb6dou	餐饮内容策略	面向正餐/快餐/咖啡茶饮/烘焙店的内容创作策略	餐饮	本地 18-50 岁吃货与家庭/朋友聚餐人群，决策受大众点评/抖音探店/朋友圈影响，追求性价比与新鲜感	到店引流 → 团购/储值 → 复购，建立「本地人爱吃」的烟火气口碑	怕难吃踩雷、怕贵不值、怕排队等太久、怕卫生不达标、选择太多无从下手	招牌菜实拍种草、隐藏菜单揭秘、老板创业故事、性价比实测、团购福利、深夜食堂/节日聚餐场景	烟火气、真实接地气、直给福利、用味道和氛围说话、少修饰多实拍	f	t	2026-08-09 13:57:51.719	2026-08-09 14:33:02.211
cmslvaokp0002i5ajfverrk6z	教育内容策略	面向 K12 培训/成人考证/早教/素质教育机构的内容创作策略	教育	K12 家长（焦虑决策）与成人学习者（考证/技能提升），家庭消费决策，重视效果与口碑	课程咨询 → 试听转化 → 报课 → 续费/转介绍，建立「专业可信」的教育品牌	怕无效浪费钱、怕踩坑选错机构、怕孩子落后焦虑、怕老师不专业、价格敏感但愿为效果买单	学习方法干货、常见误区澄清、学员真实成果见证、师资专业展示、限时优惠、教育理念输出（共鸣家长）	专业可信、有权威感、共情家长焦虑但不贩卖焦虑、用数据与成果说话	f	t	2026-08-09 13:57:51.721	2026-08-09 14:33:02.212
cmslvaokr0003i5ajtpi86ri9	微商内容策略	面向朋友圈卖货/社交电商店主的内容创作策略	微商	微信好友与私域客户（信任型消费），靠朋友圈日常渗透建立人设后转化，复购与转介绍为核心	加粉 → 发圈种草 → 私聊成交 → 复购转介绍，建立「靠谱人设」的信任生意	发圈没人看/被屏蔽、文案同质化无记忆点、只会硬广不会软性种草、私聊不会开口/不会追单、信任建立难	日常种草（用起来再说）、客户真实反馈、下单见证、生活人设（有温度）、副业机会展示、限时福利	像朋友分享而非推销、真实有温度、先价值后成交、避免刷屏式硬广、善用故事与场景	f	t	2026-08-09 13:57:51.723	2026-08-09 14:33:02.214
cmslvaokt0004i5ajxjibqwu7	直销内容策略	面向直销代理/团队/轻创业人群的内容创作策略	直销	想找副业/轻创业机会的 25-45 岁人群，对「时间自由+收入弹性」敏感，决策靠信任与榜样	事业机会展示 → 招募伙伴 → 团队建设 → 复制成长，建立「可跟可学」的团队磁场	怕被当传销、怕投入打水漂、怕没能力做、怕被家人反对、市面上机会太多真假难辨	事业机会理性展示、制度模式透明解读、领导人真实成长故事、新人 30 天见证、招商会邀约、避坑鉴别指南	理性+正能量、不吹嘘不画饼、用真实历程说话、透明讲清模式与投入、严禁收益承诺与拉人头话术（传销红线）	f	t	2026-08-09 13:57:51.726	2026-08-09 14:33:02.216
cmslw1uzk0000i5pqx4wzk2r1	健身内容策略	面向健身房/瑜伽/私教/塑形工作室的内容创作策略	健身	20-45 岁关注身材管理与健康的都市人群，会员卡决策受效果口碑与体验课影响，女性私教/瑜伽客群付费意愿强	体验课引流 → 会员卡转化 → 续课/私教课包 → 转介绍，建立「有效果+有氛围」的健身品牌	怕坚持不下来浪费钱、怕练错受伤、怕被推销、健身房离家远/环境差、身材焦虑但无从下手	学员前后对比见证、教练专业展示（资质/方法）、常见训练误区科普、体验课福利、训练日常氛围、饮食搭配干货	专业有能量、激励但不贩卖焦虑、用真实学员案例说话、强调科学训练与陪伴感	f	t	2026-08-09 14:18:59.745	2026-08-09 14:33:02.217
cmslw1uzn0001i5pqscuyesn9	母婴内容策略	面向母婴店/产后修复/月嫂/托育机构的内容创作策略	母婴	孕期与 0-6 岁宝宝的父母（妈妈决策为主），高信任型消费，口碑与专业度决定选择	信任建立 → 到店/咨询 → 办卡/服务转化 → 复购转介绍，建立「懂母婴+专业」的品牌形象	育儿焦虑（怕带不好）、怕产品不安全、怕被坑智商税、产后恢复焦虑、月嫂/托育怕不靠谱	育儿知识干货、产品安全科普（成分/认证）、产后恢复科学讲解、真实妈妈案例、专业资质展示、节日亲子活动	温暖专业、像懂行的闺蜜妈妈、用知识建立信任、不制造焦虑、强调安全与科学	f	t	2026-08-09 14:18:59.747	2026-08-09 14:33:02.218
cmslw1uzo0002i5pq7v1yl7bm	本地生活服务策略	面向家政/维修/宠物/洗护等服务型商家的内容创作策略	本地生活	本地 25-55 岁家庭，需要保洁/维修/宠物/洗护等上门或到店服务，决策靠口碑与便利性	服务咨询 → 下单转化 → 复购/包年 → 转介绍，建立「靠谱省心」的本地服务品牌	怕不专业/不卫生、怕乱收费、怕来了不走心、找服务麻烦、怕售后无保障	服务过程真实展示（前后对比）、价格透明承诺、专业资质/工具展示、客户好评见证、便民小知识、限时优惠	实在靠谱、透明不虚、用细节建立信任、突出省心与保障	f	t	2026-08-09 14:18:59.749	2026-08-09 14:33:02.219
cmslw1uzq0003i5pqrof4zeop	电商零售内容策略	面向服饰/百货/数码/食品电商店铺的内容创作策略	电商零售	18-45 岁网购人群，冲动与理性并存，决策受种草内容/优惠/评价影响，复购靠品质与体验	新品种草 → 下单转化 → 复购 → 会员沉淀，建立「品质+性价比」的店铺口碑	怕货不对板、怕质量差/色差、价格对比焦虑、选择困难、担心售后麻烦	新品实拍种草、使用场景展示、材质/工艺细节、真实买家秀、限时优惠/清仓、穿搭/搭配攻略	活泼种草、真实不吹、多用场景与细节说话、突出性价比与售后保障	f	t	2026-08-09 14:18:59.751	2026-08-09 14:33:02.22
cmslw1uzs0004i5pqwmdi9qmz	医疗健康内容策略	面向诊所/口腔/中医/体检机构的内容创作策略	医疗健康	关心健康与亚健康改善的 25-60 岁人群，家庭健康决策，对专业资质与口碑高度敏感	科普信任 → 到院咨询/体检 → 服务转化 → 家庭复购，建立「专业可信」的医疗机构品牌	怕误诊/不专业、怕过度医疗、怕乱收费、体检怕麻烦、对医院有心理抗拒	健康科普干货、常见误区澄清、医生专业背景展示、体检流程透明、真实患者（脱敏）见证、公益/便民活动	专业严谨可信、通俗易懂、用资质与数据说话、严禁疗效承诺与夸大（广告法红线）	f	t	2026-08-09 14:18:59.752	2026-08-09 14:33:02.222
cmslwjx1r0000i5yoicq8ny1a	家装内容策略	面向装修公司/建材/家居/软装商家的内容创作策略	家装	25-50 岁有装修/翻新需求的城市家庭，低频高客单决策，信任与口碑决定签约	案例展示 → 咨询量房 → 签约 → 转介绍，建立「靠谱+透明」的装修品牌	怕装修公司跑路/增项、怕材料以次充好、怕工期拖延、不懂验收被糊弄、报价不透明	真实装修案例前后对比、避坑指南（增项/材料/验收）、报价透明拆解、工地实拍进度、设计师理念、客户评价见证	专业实在、透明坦诚、用案例与细节说话、直击装修焦虑但不制造恐慌	f	t	2026-08-09 14:33:02.223	2026-08-09 14:33:02.223
cmslwjx1s0001i5yoy470vno6	汽车后市场内容策略	面向洗车/保养/维修/汽车美容店的内容创作策略	汽车后市场	20-50 岁车主（家庭主力决策），本地刚需高频服务，决策靠口碑/价格/便利	到店引流 → 保养/美容套餐 → 复购储值，建立「专业+实惠」的门店口碑	怕被宰/过度维修、怕用假配件、怕技术不行伤车、排队久、价格不透明	保养知识科普、真假配件鉴别、维修过程透明展示、价格清单公开、会员储值福利、车主真实好评	懂车实在、透明不坑、用专业细节建立信任、突出性价比与保障	f	t	2026-08-09 14:33:02.225	2026-08-09 14:33:02.225
cmslwjx1t0002i5yopp46pzq3	房产中介内容策略	面向二手房/租房/商铺中介的内容创作策略	房产中介	买房/卖房/租房的本地人群，高客单低频决策，专业与诚信是成交关键	房源曝光 → 咨询带看 → 成交 → 转介绍，建立「专业诚信」的房产顾问形象	怕被中介坑（差价/假房源）、怕手续复杂踩坑、怕错过好房源、信息不透明	真实房源实拍介绍、购房流程科普（贷款/税费/过户）、避坑指南、区域价值分析、成交客户见证、新盘/笋盘速递	专业诚信、信息透明、用真实房源与数据说话、不夸大不套路	f	t	2026-08-09 14:33:02.226	2026-08-09 14:33:02.226
cmslwjx1u0003i5yos2k5rwzl	婚庆摄影内容策略	面向婚纱/写真/跟妆/婚庆公司的内容创作策略	婚庆摄影	20-35 岁准新人（新娘决策主导），高客单低频，作品质量与口碑决定选择	作品展示 → 咨询到店 → 下单拍摄 → 转介绍，建立「审美在线+服务靠谱」的品牌	怕拍出来丑/修图假、怕隐性消费加钱、怕成品延期/丢片、风格同质化、选择困难	客片实拍展示（不同风格）、拍摄过程花絮、客户成片前后对比、套餐透明拆解、摄影师/化妆师团队、档期福利	审美在线、真诚不套路人、用真实客片说话、突出个性定制与贴心服务	f	t	2026-08-09 14:33:02.227	2026-08-09 14:33:02.227
\.


--
-- Data for Name: content_strategy_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_strategy_templates (id, industry, type, scene, hook, title, content, tone_hint, is_hot, source, enabled, created_at, updated_at) FROM stdin;
cmslvcby80000i5c32usl13yp	美业	title	数字	数字	3个被忽略的清洁步骤，让毛孔呼吸感翻倍	\N	\N	f	ai	t	2026-08-09 13:59:08.671	2026-08-09 13:59:08.671
cmslvcbyc0001i5c3b9awzfaf	美业	title	反差	反差	从“黄气脸”到透亮肌，她只做了1件事	\N	\N	f	ai	t	2026-08-09 13:59:08.677	2026-08-09 13:59:08.677
cmslvcbye0002i5c3t8ckg3zl	美业	title	疑问	疑问	为什么换季一脱妆就卡粉？90%人洗脸方式错了	\N	\N	f	ai	t	2026-08-09 13:59:08.678	2026-08-09 13:59:08.678
cmslvcbyf0003i5c30oy2puq3	美业	title	痛点	痛点	28岁开始垮脸？别急，这3个筋膜层养护动作每天5分钟	\N	\N	f	ai	t	2026-08-09 13:59:08.68	2026-08-09 13:59:08.68
cmslvcbyg0004i5c31e6z2bea	美业	title	福利	福利	【限时】首次到店送价值298元皮肤检测+定制方案	\N	\N	f	ai	t	2026-08-09 13:59:08.681	2026-08-09 13:59:08.681
cmslvcbyi0005i5c3msrcuu2k	美业	title	权威数据	权威数据	全国超67%敏感肌用户在用这款修护霜，临床实测有效率91.3%	\N	\N	f	ai	t	2026-08-09 13:59:08.682	2026-08-09 13:59:08.682
cmslvcbyj0006i5c3rbr9yw9g	美业	title	悬念	悬念	做完光子嫩肤后第3天，她发来一张对比图…	\N	\N	f	ai	t	2026-08-09 13:59:08.683	2026-08-09 13:59:08.683
cmslvcbyk0007i5c3o5pg9sls	美业	title	共情	共情	不敢素颜见客户”的销售总监，3次护理后主动关掉美颜滤镜	\N	\N	f	ai	t	2026-08-09 13:59:08.684	2026-08-09 13:59:08.684
cmslvcbyl0008i5c3mk64qenl	美业	title	故事	故事	王姐做完热玛吉第7天，老公说：“你眼角那条线好像淡了？	\N	\N	f	ai	t	2026-08-09 13:59:08.685	2026-08-09 13:59:08.685
cmslvcbym0009i5c3mmf3bxpz	美业	title	清单	清单	护肤避坑清单：这5种“平价替代”真的不建议跟风	\N	\N	f	ai	t	2026-08-09 13:59:08.686	2026-08-09 13:59:08.686
cmslvcbyn000ai5c3m7wqd2ag	美业	title	热点	热点	刘亦菲新剧同款水光肌，本地姐妹实测版来了	\N	\N	f	ai	t	2026-08-09 13:59:08.687	2026-08-09 13:59:08.687
cmslvcbyo000bi5c3dljylnxz	美业	title	对比	对比	别人做水光针肿3天，她第二天就去开晨会	\N	\N	f	ai	t	2026-08-09 13:59:08.688	2026-08-09 13:59:08.688
cmslvcbyp000ci5c3qhb3kayi	美业	title	对比	对比	7天淡斑实录｜黄褐斑面积缩小42%，附每日打卡照	\N	\N	f	ai	t	2026-08-09 13:59:08.689	2026-08-09 13:59:08.689
cmslvcbyq000di5c3a0rm8wga	美业	title	对比	对比	从“口罩脸”到摘下口罩被夸“气色真好”，她只坚持了21天	\N	\N	f	ai	t	2026-08-09 13:59:08.69	2026-08-09 13:59:08.69
cmslvcbyq000ei5c38c07wd3l	美业	title	对比	对比	为什么有人打完水光针反而更干？真相和你想的不一样	\N	\N	f	ai	t	2026-08-09 13:59:08.691	2026-08-09 13:59:08.691
cmslvcbyr000fi5c3acrxcfex	美业	title	对比	对比	2年前做完线雕后悔了？现在补救还来得及吗	\N	\N	f	ai	t	2026-08-09 13:59:08.692	2026-08-09 13:59:08.692
cmslvcbys000gi5c3qrz1wrsn	美业	title	对比	对比	【今日仅限12名】预约即赠无菌操作视频+消毒溯源码	\N	\N	f	ai	t	2026-08-09 13:59:08.693	2026-08-09 13:59:08.693
cmslvcbyt000hi5c3gg9u9te4	美业	title	对比	对比	卫健委最新《美容场所卫生规范》实施后，我们拆掉了3面墙重装	\N	\N	f	ai	t	2026-08-09 13:59:08.693	2026-08-09 13:59:08.693
cmslvcbyt000ii5c3494qdzlp	美业	title	对比	对比	她做完超声刀回家路上接到初恋电话：“你最近是不是瘦了？	\N	\N	f	ai	t	2026-08-09 13:59:08.694	2026-08-09 13:59:08.694
cmslvcbyu000ji5c3jhapmv5g	美业	title	对比	对比	做完脸僵”不是项目问题，是这2个关键点没沟通清楚	\N	\N	f	ai	t	2026-08-09 13:59:08.695	2026-08-09 13:59:08.695
cmslvcbyv000ki5c3gag6uzg8	美业	title	对比	对比	李医生从业18年，只推荐这3类人做皮秒（附筛选表）	\N	\N	f	ai	t	2026-08-09 13:59:08.696	2026-08-09 13:59:08.696
cmslvcbyw000li5c3cy3s9yke	美业	title	对比	对比	抗老清单：30+女生必查的5项皮肤指标，第4项90%人忽略	\N	\N	f	ai	t	2026-08-09 13:59:08.696	2026-08-09 13:59:08.696
cmslvcbyw000mi5c38501gxpa	美业	title	对比	对比	巴黎时装周后台都在用的头皮SPA，杭州首家落地版体验记	\N	\N	f	ai	t	2026-08-09 13:59:08.697	2026-08-09 13:59:08.697
cmslvcbyx000ni5c3h2t2kxoi	美业	title	对比	对比	别人敷面膜越敷越闷痘，她用对方法后闭口全消了	\N	\N	f	ai	t	2026-08-09 13:59:08.697	2026-08-09 13:59:08.697
cmslvcbyy000oi5c3qrwypp9c	美业	title	对比	对比	12个让效果打折的护理细节，第9个连美容师都常忘	\N	\N	f	ai	t	2026-08-09 13:59:08.698	2026-08-09 13:59:08.698
cmslvcbyy000pi5c3n107bv2d	美业	title	对比	对比	从“熬夜脸”逆袭成早八人状态脸，她把晨间流程精简到8分钟	\N	\N	f	ai	t	2026-08-09 13:59:08.699	2026-08-09 13:59:08.699
cmslvcbyz000qi5c3h0l7x6ec	美业	title	对比	对比	为什么做完小气泡后爆痘？不是过敏，是代谢在启动	\N	\N	f	ai	t	2026-08-09 13:59:08.699	2026-08-09 13:59:08.699
cmslvcbyz000ri5c3guqn1wr8	美业	title	对比	对比	35岁二胎妈妈做完肩颈管理，第一次自己系上衬衫最上面那颗扣子	\N	\N	f	ai	t	2026-08-09 13:59:08.7	2026-08-09 13:59:08.7
cmslvcbz0000si5c3hts1r3qq	美业	title	对比	对比	【会员日加赠】带1位闺蜜同行，两人各得1次免费深层清洁	\N	\N	f	ai	t	2026-08-09 13:59:08.701	2026-08-09 13:59:08.701
cmslvcbz1000ti5c3vmpg2fp2	美业	title	对比	对比	中国整形美容协会2024数据：超6成消费者因“术前沟通不清”放弃项目	\N	\N	f	ai	t	2026-08-09 13:59:08.701	2026-08-09 13:59:08.701
cmslvcbz1000ui5c3upc9d5mg	美业	title	对比	对比	她做完黄金微针第5天，同事问：“你最近是不是偷偷去打了玻尿酸？	\N	\N	f	ai	t	2026-08-09 13:59:08.702	2026-08-09 13:59:08.702
cmslvcbz1000vi5c3hwq0tpc2	美业	title	对比	对比	做完脸凹了”？其实是填充层次选错了，附真实案例分层示意图	\N	\N	f	ai	t	2026-08-09 13:59:08.702	2026-08-09 13:59:08.702
cmslvcbz2000wi5c30unwyydm	美业	title	对比	对比	张院亲授｜如何判断一家店值不值得长期跟，看这4个细节就够了	\N	\N	f	ai	t	2026-08-09 13:59:08.702	2026-08-09 13:59:08.702
cmslvcbz2000xi5c3yqg95559	美业	title	对比	对比	变美清单：在家就能做的5个淋巴引流手法，配图文版	\N	\N	f	ai	t	2026-08-09 13:59:08.703	2026-08-09 13:59:08.703
cmslvcbz3000yi5c3qwjvu506	美业	title	对比	对比	董洁直播提到的“冷白皮养成法”，本地皮肤科医生这样说	\N	\N	f	ai	t	2026-08-09 13:59:08.703	2026-08-09 13:59:08.703
cmslvcbz3000zi5c3cj32dbfd	美业	title	对比	对比	别人做面部提升要花3万，她用分阶段方案控制在8980元	\N	\N	f	ai	t	2026-08-09 13:59:08.704	2026-08-09 13:59:08.704
cmslvcbz40010i5c32x21wstn	美业	title	对比	对比	5次护理后，我终于敢把自拍原图发朋友圈了	\N	\N	f	ai	t	2026-08-09 13:59:08.704	2026-08-09 13:59:08.704
cmslvcbz50011i5c3ndqv4udq	美业	title	对比	对比	从被说“显老”到被追问年龄，她把抗衰计划拆解成每月1个小目标	\N	\N	f	ai	t	2026-08-09 13:59:08.706	2026-08-09 13:59:08.706
cmslvcbz50012i5c36hvtps5n	美业	title	对比	对比	为什么做完光电项目后肤色反而暗沉？可能是能量参数设高了	\N	\N	f	ai	t	2026-08-09 13:59:08.706	2026-08-09 13:59:08.706
cmslvcbz60013i5c3s3igh9bj	美业	title	对比	对比	32岁程序员做完眼周管理，第一次被客户说“眼神有光	\N	\N	f	ai	t	2026-08-09 13:59:08.706	2026-08-09 13:59:08.706
cmslvcbz60014i5c3454lr5nu	美业	title	对比	对比	【新客专享】扫码预约，立减300并锁定本月最后8个无菌舱时段	\N	\N	f	ai	t	2026-08-09 13:59:08.707	2026-08-09 13:59:08.707
cmslvcbz70015i5c3eoohis78	美业	title	对比	对比	《中国医美消费白皮书》显示：决策周期超7天的顾客，复购率高出2.3倍	\N	\N	f	ai	t	2026-08-09 13:59:08.708	2026-08-09 13:59:08.708
cmslvcbz80016i5c37g187l31	美业	title	对比	对比	做完超光子第2周，她收到HR消息：“下周晋升答辩，记得穿浅色衬衫	\N	\N	f	ai	t	2026-08-09 13:59:08.708	2026-08-09 13:59:08.708
cmslvcbz80017i5c3cmw86sfq	美业	title	对比	对比	做完像假脸”？那是你没做动态表情训练，附康复期每日练习表	\N	\N	f	ai	t	2026-08-09 13:59:08.709	2026-08-09 13:59:08.709
cmslvcbz90018i5c35p5wz0pn	美业	title	对比	对比	浙大二院皮肤科联合调研：正确术后护理可提升效果留存率至86%	\N	\N	f	ai	t	2026-08-09 13:59:08.71	2026-08-09 13:59:08.71
cmslvcbza0019i5c3jkg0iwqk	美业	title	对比	对比	抗初老自查清单：这6个信号出现2个，建议尽快做皮肤CT扫描	\N	\N	f	ai	t	2026-08-09 13:59:08.71	2026-08-09 13:59:08.71
cmslvcbza001ai5c3pu1dmprt	美业	title	对比	对比	《繁花》宝总同款“松弛感发型”，杭州老师傅手作还原版	\N	\N	f	ai	t	2026-08-09 13:59:08.711	2026-08-09 13:59:08.711
cmslvcbzb001bi5c3qz7aaa9h	美业	title	对比	对比	90%人不知道的卸妆盲区，藏在耳后和发际线交界处	\N	\N	f	ai	t	2026-08-09 13:59:08.711	2026-08-09 13:59:08.711
cmslvcbzb001ci5c3qoxbq6c1	美业	title	对比	对比	从“素颜不敢出地铁”到通勤路上自然光自拍，她用了42天	\N	\N	f	ai	t	2026-08-09 13:59:08.712	2026-08-09 13:59:08.712
cmslvcbzb001di5c3j5it4w08	美业	title	对比	对比	为什么做完黑眼圈项目反而更青？可能是血管型误判为色素型	\N	\N	f	ai	t	2026-08-09 13:59:08.712	2026-08-09 13:59:08.712
cmslvcbzc001ei5c3iim7wl2f	美业	title	对比	对比	产后3年第一次穿露肩装，她说：“不是瘦了，是轮廓回来了	\N	\N	f	ai	t	2026-08-09 13:59:08.712	2026-08-09 13:59:08.712
cmslvcbzc001fi5c38yjarcwk	美业	title	对比	对比	【今明两天】转发本文+定位门店，到店即赠医用级冰镇舒缓喷雾	\N	\N	f	ai	t	2026-08-09 13:59:08.713	2026-08-09 13:59:08.713
cmslvcbzd001gi5c3gv675mqz	美业	title	对比	对比	杭州市卫健委飞检通报：近3月合格率TOP3的美业机构名单（含我们）	\N	\N	f	ai	t	2026-08-09 13:59:08.713	2026-08-09 13:59:08.713
cmslvcbzd001hi5c32lvfbos7	美业	title	对比	对比	做完热拉提回家，女儿摸着我的脸说：“妈妈的脸变滑滑的了	\N	\N	f	ai	t	2026-08-09 13:59:08.714	2026-08-09 13:59:08.714
cmslvcbze001ii5c3fp5o556k	美业	title	对比	对比	做完脸泛红持续一周”？不是过敏，是屏障修复期，这样做能加速恢复	\N	\N	f	ai	t	2026-08-09 13:59:08.714	2026-08-09 13:59:08.714
cmslvcbze001ji5c3nra2q5cb	美业	title	对比	对比	从业15年纹绣师坦白：这4类眉形根本不适合圆脸女生（附脸型对照图）	\N	\N	f	ai	t	2026-08-09 13:59:08.715	2026-08-09 13:59:08.715
cmslvcbzf001ki5c3gcybru2x	美业	title	对比	对比	夏季变美清单：空调房必备的5件保湿装备，第3件95%人没用对	\N	\N	f	ai	t	2026-08-09 13:59:08.716	2026-08-09 13:59:08.716
cmslvcbzg001li5c379xr3606	美业	title	对比	对比	奥运冠军同款运动康复理	\N	\N	f	ai	t	2026-08-09 13:59:08.717	2026-08-09 13:59:08.717
cmslvczr60000i5cxs7kiypl7	美业	title	数字	数字	3个被忽略的清洁步骤，让毛孔呼吸感拉满	\N	\N	f	ai	t	2026-08-09 13:59:39.521	2026-08-09 13:59:39.521
cmslvczr90001i5cxdeqyaazg	美业	title	反差	反差	从“黄气脸”到“发光肌”，她只做了这1次护理	\N	\N	f	ai	t	2026-08-09 13:59:39.526	2026-08-09 13:59:39.526
cmslvczrb0002i5cx39lo55uk	美业	title	疑问	疑问	为什么你天天敷面膜，脸还是暗沉？真相在这	\N	\N	f	ai	t	2026-08-09 13:59:39.527	2026-08-09 13:59:39.527
cmslvczrc0003i5cxcwps4kbo	美业	title	痛点	痛点	28岁开始垮脸？皮肤科医生说：90%的人没做对这件事	\N	\N	f	ai	t	2026-08-09 13:59:39.529	2026-08-09 13:59:39.529
cmslvczrd0004i5cxyanw2644	美业	title	福利	福利	本周限时｜首次到店送价值298元水光体验+消毒报告公开	\N	\N	f	ai	t	2026-08-09 13:59:39.53	2026-08-09 13:59:39.53
cmslvczre0005i5cxeho8c6fl	美业	title	权威数据	权威数据	全国超67%的轻熟肌客户，都在用这套抗初老方案	\N	\N	f	ai	t	2026-08-09 13:59:39.531	2026-08-09 13:59:39.531
cmslvczrf0006i5cxjgr2aex1	美业	title	悬念	悬念	做完脸更垮了？”——我们拆解3个被夸爆项目的真相	\N	\N	f	ai	t	2026-08-09 13:59:39.532	2026-08-09 13:59:39.532
cmslvczrg0007i5cx9vjctyuv	美业	title	共情	共情	看到她晒素颜照那天，我默默取消了医美预约	\N	\N	f	ai	t	2026-08-09 13:59:39.533	2026-08-09 13:59:39.533
cmslvczri0008i5cxfjyni8hb	美业	title	故事	故事	上周王姐做完肩颈调理，老公说：“你最近像换了个人	\N	\N	f	ai	t	2026-08-09 13:59:39.534	2026-08-09 13:59:39.534
cmslvczri0009i5cxjcps6z9w	美业	title	清单	清单	护肤避坑清单｜这5个“伪刚需”项目，真没必要花冤枉钱	\N	\N	f	ai	t	2026-08-09 13:59:39.535	2026-08-09 13:59:39.535
cmslvczrj000ai5cx91u0cz4h	美业	title	热点	热点	《2024本地美业白皮书》刚发布：小众项目复购率暴涨210%	\N	\N	f	ai	t	2026-08-09 13:59:39.536	2026-08-09 13:59:39.536
cmslvczrk000bi5cxkw9omr00	美业	title	对比	对比	别人做热玛吉脸僵，她做后反而更自然？关键在术前评估	\N	\N	f	ai	t	2026-08-09 13:59:39.537	2026-08-09 13:59:39.537
cmslvczrm000ci5cx34tbz3e2	美业	title	对比	对比	7天不洗脸，皮肤反而变好？我们测了12位顾客数据	\N	\N	f	ai	t	2026-08-09 13:59:39.538	2026-08-09 13:59:39.538
cmslvczrn000di5cxefbpb1nk	美业	title	对比	对比	从痘坑妹到团建C位，她靠1次微针重建了自信	\N	\N	f	ai	t	2026-08-09 13:59:39.539	2026-08-09 13:59:39.539
cmslvczrn000ei5cxljhmipcu	美业	title	对比	对比	做完脸发红还脱皮？”你可能踩中了这3个操作雷区	\N	\N	f	ai	t	2026-08-09 13:59:39.54	2026-08-09 13:59:39.54
cmslvczro000fi5cxiwenyoqr	美业	title	对比	对比	35岁宝妈的真实日记：产后松弛不是忍着，是选对方式	\N	\N	f	ai	t	2026-08-09 13:59:39.541	2026-08-09 13:59:39.541
cmslvczrp000gi5cxr1j9rk08	美业	title	对比	对比	新客专享｜到店即赠「安心三证」（消毒/持证/耗材溯源）	\N	\N	f	ai	t	2026-08-09 13:59:39.541	2026-08-09 13:59:39.541
cmslvczrq000hi5cx7ixdp2f7	美业	title	对比	对比	上海静安区门店实测：紫外线灯下，99.2%器械达标	\N	\N	f	ai	t	2026-08-09 13:59:39.542	2026-08-09 13:59:39.542
cmslvczrr000ii5cxvu3ukjhg	美业	title	对比	对比	做完像假脸？”别慌，这才是真正自然妈生感的关键	\N	\N	f	ai	t	2026-08-09 13:59:39.543	2026-08-09 13:59:39.543
cmslvczrs000ji5cxp12sfiah	美业	title	对比	对比	李姐二胎后腰腹松垮，坚持3次射频+饮食记录，围度-5cm	\N	\N	f	ai	t	2026-08-09 13:59:39.544	2026-08-09 13:59:39.544
cmslvczrs000ki5cx6co88eic	美业	title	对比	对比	95后程序员小林的第一次头皮管理：原来掉发能被“按”回来	\N	\N	f	ai	t	2026-08-09 13:59:39.545	2026-08-09 13:59:39.545
cmslvczrt000li5cxiwgxg2ed	美业	title	对比	对比	护肤必看清单｜这6种“越养越差”的习惯，90%人天天在做	\N	\N	f	ai	t	2026-08-09 13:59:39.545	2026-08-09 13:59:39.545
cmslvczrt000mi5cxe4otpk73	美业	title	对比	对比	抖音爆款“冷白皮滤镜”背后，其实是这组精准光疗参数	\N	\N	f	ai	t	2026-08-09 13:59:39.546	2026-08-09 13:59:39.546
cmslvczru000ni5cxzi6z8f9p	美业	title	对比	对比	杭州西湖区客户反馈：同一款精华，换手法吸收率差3.2倍	\N	\N	f	ai	t	2026-08-09 13:59:39.546	2026-08-09 13:59:39.546
cmslvczru000oi5cxt97adyo2	美业	title	对比	对比	12个细节暴露你的皮肤年龄，第7个90%人中招	\N	\N	f	ai	t	2026-08-09 13:59:39.547	2026-08-09 13:59:39.547
cmslvczrv000pi5cx5f0641mr	美业	title	对比	对比	从不敢素颜上班，到主动开视频会议｜她的蜕变只有28天	\N	\N	f	ai	t	2026-08-09 13:59:39.547	2026-08-09 13:59:39.547
cmslvczrv000qi5cxki22ne7r	美业	title	对比	对比	为什么别家做完泛红三天，你们当天就能上妆？	\N	\N	f	ai	t	2026-08-09 13:59:39.548	2026-08-09 13:59:39.548
cmslvczrw000ri5cx2mjaiomt	美业	title	对比	对比	2年没剪过一次头发的男生，来我们这儿剪完被同事追着问理发师	\N	\N	f	ai	t	2026-08-09 13:59:39.548	2026-08-09 13:59:39.548
cmslvczrw000si5cx3j441prg	美业	title	对比	对比	会员日加赠｜手写版《你的肌肤档案》+每月1次免费检测	\N	\N	f	ai	t	2026-08-09 13:59:39.549	2026-08-09 13:59:39.549
cmslvczrx000ti5cx20rfakzf	美业	title	对比	对比	卫健委最新通报：美容场所器械消毒合格率仅73.6%，我们怎么做？	\N	\N	f	ai	t	2026-08-09 13:59:39.549	2026-08-09 13:59:39.549
cmslvczrx000ui5cx3myw3jbt	美业	title	对比	对比	做完脸肿得像馒头？”揭秘：你以为的“效果”，其实是炎症反应	\N	\N	f	ai	t	2026-08-09 13:59:39.55	2026-08-09 13:59:39.55
cmslvczry000vi5cxp283ryn3	美业	title	对比	对比	产科护士小陈产后修复日记：盆底肌训练+筋膜放松双线并进	\N	\N	f	ai	t	2026-08-09 13:59:39.551	2026-08-09 13:59:39.551
cmslvczrz000wi5cxsxh79nqt	美业	title	对比	对比	90后插画师阿雅：做完发质检测，才发现自己一直用错洗发水	\N	\N	f	ai	t	2026-08-09 13:59:39.551	2026-08-09 13:59:39.551
cmslvczrz000xi5cx6uvp03c0	美业	title	对比	对比	居家护肤清单｜这5样家里常备品，混搭可能毁脸	\N	\N	f	ai	t	2026-08-09 13:59:39.551	2026-08-09 13:59:39.551
cmslvczrz000yi5cxzrl9zfea	美业	title	对比	对比	刘畊宏跳操瘦了腿，却胖了肚子？体态评估发现核心代偿真相	\N	\N	f	ai	t	2026-08-09 13:59:39.552	2026-08-09 13:59:39.552
cmslvczs1000zi5cx6oq259wk	美业	title	对比	对比	北京朝阳区3家门店联合发布：真实客户6个月体脂变化曲线图	\N	\N	f	ai	t	2026-08-09 13:59:39.553	2026-08-09 13:59:39.553
cmslvczs10010i5cxw7y77um2	美业	title	对比	对比	21天晨间护肤流程，她把黄气脸熬成了透亮感	\N	\N	f	ai	t	2026-08-09 13:59:39.554	2026-08-09 13:59:39.554
cmslvczs20011i5cx51ns00kx	美业	title	对比	对比	从前总被说“显老”，现在闺蜜问：“你偷偷打针了？	\N	\N	f	ai	t	2026-08-09 13:59:39.554	2026-08-09 13:59:39.554
cmslvczs20012i5cxe2vri1nk	美业	title	对比	对比	做完脸蜡黄还起皮？”不是产品问题，是你忽略了这步	\N	\N	f	ai	t	2026-08-09 13:59:39.555	2026-08-09 13:59:39.555
cmslvczs30013i5cxb3c7y6z0	美业	title	对比	对比	42岁HR总监的抗衰坦白局：不做大项目，靠日常管理稳住状态	\N	\N	f	ai	t	2026-08-09 13:59:39.555	2026-08-09 13:59:39.555
cmslvczs30014i5cxiix3z726	美业	title	对比	对比	今日到店福利｜拍消毒柜实时画面+耗材开封视频，立减150元	\N	\N	f	ai	t	2026-08-09 13:59:39.556	2026-08-09 13:59:39.556
cmslvczs40015i5cxysnmkqsb	美业	title	对比	对比	中国整形美容协会2024数据：非侵入类项目投诉下降41%，关键在…	\N	\N	f	ai	t	2026-08-09 13:59:39.556	2026-08-09 13:59:39.556
cmslvczs40016i5cx5sn4upgd	美业	title	对比	对比	为什么我做完比别人恢复慢？”皮肤屏障自测表免费领	\N	\N	f	ai	t	2026-08-09 13:59:39.557	2026-08-09 13:59:39.557
cmslvczs50017i5cxxo8lh372	美业	title	对比	对比	产后6个月，她带着娃来做修复，结束时眼圈都淡了	\N	\N	f	ai	t	2026-08-09 13:59:39.557	2026-08-09 13:59:39.557
cmslvczs50018i5cxkwxcseuw	美业	title	对比	对比	客户张婷的对比图没P：左图是孕晚期，右图是产后3次筋膜调理后	\N	\N	f	ai	t	2026-08-09 13:59:39.558	2026-08-09 13:59:39.558
cmslvczs60019i5cxjmthr45d	美业	title	对比	对比	年度自查清单｜这7个身体信号，说明你需要专业体态干预	\N	\N	f	ai	t	2026-08-09 13:59:39.558	2026-08-09 13:59:39.558
cmslvczs6001ai5cxqly2033u	美业	title	对比	对比	五一出游前急救”热度飙升！本地姐妹都在抢这个焕肤档期	\N	\N	f	ai	t	2026-08-09 13:59:39.559	2026-08-09 13:59:39.559
cmslvczs7001bi5cxg5whautc	美业	title	对比	对比	深圳南山客户实测：同一台仪器，不同操作师效果差异达37%	\N	\N	f	ai	t	2026-08-09 13:59:39.559	2026-08-09 13:59:39.559
cmslvczs7001ci5cxzp0toy0x	美业	title	对比	对比	5次头皮SPA后，洗头掉发少了60%，她终于敢扎高马尾	\N	\N	f	ai	t	2026-08-09 13:59:39.56	2026-08-09 13:59:39.56
cmslvczs8001di5cxnxo3xnex	美业	title	对比	对比	从被吐槽“路人感”，到婚礼当天被追问化妆师是谁	\N	\N	f	ai	t	2026-08-09 13:59:39.56	2026-08-09 13:59:39.56
cmslvczs8001ei5cxqnpvp5iy	美业	title	对比	对比	为什么别家做一次要3小时，我们只要45分钟？	\N	\N	f	ai	t	2026-08-09 13:59:39.561	2026-08-09 13:59:39.561
cmslvczs9001fi5cxqxj9sl3k	美业	title	对比	对比	30岁后不敢穿露肩装？肩颈线条重塑后，她买了5条吊带裙	\N	\N	f	ai	t	2026-08-09 13:59:39.561	2026-08-09 13:59:39.561
cmslvczs9001gi5cx5fytp6zm	美业	title	对比	对比	限时回归｜老客带新客，双方各得1次深层清洁+无菌环境直播	\N	\N	f	ai	t	2026-08-09 13:59:39.562	2026-08-09 13:59:39.562
cmslvczsa001hi5cxhbhc3tzf	美业	title	对比	对比	权威期刊《J Cosmet Dermatol》证实：温和去角质提升吸收率2.3倍	\N	\N	f	ai	t	2026-08-09 13:59:39.562	2026-08-09 13:59:39.562
cmslvczsa001ii5cxjpnd3vl9	美业	title	对比	对比	做完脸紧绷像面具？”小心！你可能被过度提拉了	\N	\N	f	ai	t	2026-08-09 13:59:39.562	2026-08-09 13:59:39.562
cmslvczsa001ji5cxwxyoxoxt	美业	title	对比	对比	新手妈妈小薇的逆袭：哺乳期安全项目清单+营养师协同方案	\N	\N	f	ai	t	2026-08-09 13:59:39.563	2026-08-09 13:59:39.563
cmslvczsb001ki5cx0wwa05u7	美业	title	对比	对比	客户阿哲剪完头发，理发师说：“你这发质，三年没好好养过	\N	\N	f	ai	t	2026-08-09 13:59:39.564	2026-08-09 13:59:39.564
cmslvczsc001li5cxgf9b00zv	美业	title	对比	对比	家居护理避坑清单｜这4类网红工具，家用风险远高于功效	\N	\N	f	ai	t	2026-08-09 13:59:39.564	2026-08-09 13:59:39.564
cmslvczsc001mi5cxyl2nyxqy	美业	title	对比	对比	黑眼圈涂再多眼霜也没用？”中医体质辨识后调整作息才见效	\N	\N	f	ai	t	2026-08-09 13:59:39.565	2026-08-09 13:59:39.565
cmslvczsd001ni5cxmao965tn	美业	title	对比	对比	小红书爆文同款“冷白皮”光谱分析	\N	\N	f	ai	t	2026-08-09 13:59:39.565	2026-08-09 13:59:39.565
cmslvdjjw001oi5cxi8jea0pt	美业	article	新客引流	\N	\N	新客到店免费体验「小气泡深层清洁+皮肤检测」，不推销、不套路，做完直接拿检测报告和定制建议。我们懂你的顾虑——怕被强推项目、怕效果夸大、怕卫生不过关。所有仪器一客一消毒，毛巾高温灭菌，美容师持证上岗。上周有位32岁的宝妈说：“第一次没办卡就做了，结果皮肤透亮得自己都惊讶。”现在预约还送《居家护肤避坑指南》电子版，扫码锁定名额，每天仅限8个体验位。	\N	f	ai	t	2026-08-09 14:00:05.18	2026-08-09 14:00:05.18
cmslvdjjx001pi5cxsxq4k0ol	美业	article	老客复购	\N	\N	听说你刷小红书种草了“刷酸”？先别急着下单！不同肤质适合的酸浓度、频率、搭配修护全不同。上周一位油痘肌姑娘自行刷水杨酸后泛红脱皮，来店检测才发现屏障已受损。我们用VISIA检测+专业咨询帮你判断是否适合、怎么刷才安全。附赠《刷酸自查清单》（含禁忌时段/搭配雷区/修复信号），评论区留言“刷酸”，马上发你。	\N	f	ai	t	2026-08-09 14:00:05.182	2026-08-09 14:00:05.182
cmslvdjjy001qi5cxzeu7vjvp	美业	article	产品种草	\N	\N	很多姐妹问：“做完光子嫩肤，为什么别人发光我发红？”真相是：参数没按你的肤色、厚度、敏感度调！我们坚持“一人一方”定制能量，操作前必做 Fitzpatrick 分型+皮肤屏障测试。上月一位41岁黄褐斑客户，三次治疗后色斑减淡60%，但第1次只做半脸观察反应。不拼速度，只拼稳准。现在预约可享免费术前评估+术后冷敷包带走。	\N	f	ai	t	2026-08-09 14:00:05.182	2026-08-09 14:00:05.182
cmslvdwgb002gi5cx4zjf3t2w	美业	topic	\N	\N	双11理性消费指南：这5个护理项目真没必要年卡，我们主动劝退了7位客户	\N	\N	f	ai	t	2026-08-09 14:00:21.899	2026-08-09 14:00:21.899
cmslvdjjy001ri5cxkojzm8m1	美业	article	客户见证	\N	\N	端午节不只有粽子，还有“安心美”计划：到店即赠艾草香囊+定制防晒手账；消费满888元，加赠端午限定「舒缓褪红护理」1次（含积雪草精华导入+低温射频）；老会员带新客同行，双方各得200积分。所有项目明码标价，无隐藏收费，发票明细清晰列项。这个节日，我们想让你美得踏实、放松、有仪式感。	\N	f	ai	t	2026-08-09 14:00:05.183	2026-08-09 14:00:05.183
cmslvdjjz001si5cxu4za10ve	美业	article	节假日活动	\N	\N	开业三年，我们没投过一条信息流广告，87%新客来自老客微信推荐。为什么？因为李姐做完肩颈调理后，连续介绍5位同事来；因为薇薇产后斑用我们的分层淡斑方案，3个月后素颜敢开视频会议；因为每次换季，总有客户提前一周预约“屏障急救”。我们不做快销式美业，只做“你愿意介绍给闺蜜”的那一家。玻璃门常开，欢迎随时进来坐坐，喝杯花茶，聊聊皮肤最近的小情绪。	\N	f	ai	t	2026-08-09 14:00:05.184	2026-08-09 14:00:05.184
cmslvdjk0001ti5cxcsf2sgxw	美业	article	品牌故事	\N	\N	本周上新｜「微电流+射频双模提拉」正式上线！不是普通EMS，而是德国进口设备+临床验证手法：先用微电流唤醒肌肉记忆，再以可控射频热能刺激胶原再生。实测20位35+女性，单次后下颌线清晰度提升明显（附对比图）。重点：全程无创、无恢复期、不结痂。首周体验价398元（原价880），含专属提拉手法教学视频回看权限，限前30名。	\N	f	ai	t	2026-08-09 14:00:05.184	2026-08-09 14:00:05.184
cmslvdjk0001ui5cxxqh01foe	美业	article	上新公告	\N	\N	夏季头皮出油头屑多？不是洗太勤，是毛囊微生态失衡了！我们升级「头皮菌群平衡管理」：先用高清头皮镜分析油脂分布+真菌活跃度，再配比益生元精华+低温LED照射调节pH值。王女士反馈：“做完第三次，枕套终于不油了，掉发也少了。”现推出99元「头皮健康初筛」（含检测+1次基础平衡护理），扫码预约，送《夏季头皮自救手册》PDF版。	\N	f	ai	t	2026-08-09 14:00:05.185	2026-08-09 14:00:05.185
cmslvdjk1001vi5cxt5a8z8dj	美业	article	优惠活动	\N	\N	上周有位客户说：“你们价格表贴在前台，连耗材品牌都写清楚，反而让我更敢花钱。”——这就是我们的定价逻辑：光子嫩肤498元/次（含冷凝胶+术后修复霜），无捆绑、无起号费、无“必须做5次才有效”话术。所有项目支持单次体验，效果说话。本月起，每笔消费同步生成电子凭证，含设备编号、操作师姓名、耗材批次，扫码可查。信任，从透明开始。	\N	f	ai	t	2026-08-09 14:00:05.185	2026-08-09 14:00:05.185
cmslvdjk1001wi5cxxg7c8sod	美业	article	知识科普	\N	\N	为什么“补水”后脸反而更干？因为你补的是水，缺的是“锁水能力”。角质层像砖墙，水是墙缝里的灰浆，神经酰胺才是粘合砖块的水泥。我们用Tewameter测皮脂率+Corneometer测含水量，再配比含神经酰胺+胆固醇+脂肪酸的仿生膜修复方案。附赠《屏障自测三问》：洗脸后紧绷超10分钟？空调房待2小时就泛红？换护肤品总刺痛？中1条，建议来检。	\N	f	ai	t	2026-08-09 14:00:05.186	2026-08-09 14:00:05.186
cmslvdjk2001xi5cxtsfi51tj	美业	article	互动话题	\N	\N	你最近最想改善的一个变美小目标是什么？	\N	f	ai	t	2026-08-09 14:00:05.186	2026-08-09 14:00:05.186
cmslvdjk2001yi5cxq699dvdk	美业	article	答疑辟谣	\N	\N	👉 是眼尾细纹淡一点？	\N	f	ai	t	2026-08-09 14:00:05.187	2026-08-09 14:00:05.187
cmslvdjk3001zi5cxog3ikazw	美业	article	会员权益	\N	\N	👉 是穿吊带敢露肩线？	\N	f	ai	t	2026-08-09 14:00:05.187	2026-08-09 14:00:05.187
cmslvdjk30020i5cxusf3lkcl	美业	article	会员权益	\N	\N	👉 还是素颜出门不靠粉底遮毛孔？	\N	f	ai	t	2026-08-09 14:00:05.188	2026-08-09 14:00:05.188
cmslvdjk40021i5cx34fjotyp	美业	article	会员权益	\N	\N	评论区写下它，我们抽10位送「精准改善方案」1份（含问题归因+3步居家动作+1次到店针对性护理）。不画大饼，只给可执行的小切口。美，本就不该是模糊愿望，而是具体进步。	\N	f	ai	t	2026-08-09 14:00:05.189	2026-08-09 14:00:05.189
cmslvdjk50022i5cxaxd423s9	美业	article	会员权益	\N	\N	“打水光针会加速衰老？”❌错。真正加速衰老的是反复创伤+无防护+错误护理。合规水光成分（如透明质酸+氨基酸）是补充营养，而非“撑皮肤”。我们所有注射类项目，由卫健委注册医师面诊+签署知情同意书+术后48小时专属回访。附《水光避坑5条》：不承诺“一次嫩十岁”、不混搭不明成分、不省略麻药步骤……需要？留言“水光”，秒发你。	\N	f	ai	t	2026-08-09 14:00:05.189	2026-08-09 14:00:05.189
cmslvdjk50023i5cxn0daqdt7	美业	article	会员权益	\N	\N	会员生日月享「美力加倍日」：当月任意消费，积分×2；到店即赠定制生日手作香薰蜡片（大豆基底+真实干花）；还可预约「会员专属顾问时间」——1v1复盘近3个月皮肤变化+调整下一阶段方案。没有“充1000送200”的套路，只有“你认真变美，我们认真记下每一次进步”。现有会员已超1260人，平均复购周期37天。	\N	f	ai	t	2026-08-09 14:00:05.19	2026-08-09 14:00:05.19
cmslvdwfv0024i5cx1i2wglf2	美业	topic	\N	\N	春天过敏季来了，我们拆解了12位客户春季烂脸的真实修复记录（附前后对比+成分避雷清单）	\N	\N	f	ai	t	2026-08-09 14:00:21.881	2026-08-09 14:00:21.881
cmslvdwfz0025i5cxpuqrad06	美业	topic	\N	\N	清明踏青前3天，做一次「轻感光疗」让皮肤稳如老狗｜真实客户反馈合集	\N	\N	f	ai	t	2026-08-09 14:00:21.888	2026-08-09 14:00:21.888
cmslvdwg00026i5cx0zdn724p	美业	topic	\N	\N	五一出游倒计时！发型师手把手教你怎么选一款“扛得住高铁+海风+自拍”的发型	\N	\N	f	ai	t	2026-08-09 14:00:21.889	2026-08-09 14:00:21.889
cmslvdwg10027i5cxeqm050n5	美业	topic	\N	\N	520前夕，我们悄悄给30位来店女生做了「微表情管理测评」：原来你笑起来显老的元凶是它	\N	\N	f	ai	t	2026-08-09 14:00:21.89	2026-08-09 14:00:21.89
cmslvdwg20028i5cx0mbi1c65	美业	topic	\N	\N	高考结束那天，店里迎来第一批00后准大学生咨询「素颜自信计划」｜真实对话实录	\N	\N	f	ai	t	2026-08-09 14:00:21.89	2026-08-09 14:00:21.89
cmslvdwg30029i5cxyfc7d6bh	美业	topic	\N	\N	618不囤护肤品，我们送你一份「成分适配型护理方案」｜扫码测肤质领免费体验	\N	\N	f	ai	t	2026-08-09 14:00:21.891	2026-08-09 14:00:21.891
cmslvdwg4002ai5cxhy4f53ub	美业	topic	\N	\N	梅雨季头皮总油头屑多？洗护师用PH试纸现场演示：90%人用错了洗发水	\N	\N	f	ai	t	2026-08-09 14:00:21.892	2026-08-09 14:00:21.892
cmslvdwg5002bi5cxcjw0n43h	美业	topic	\N	\N	三伏天不做项目？错！这4类人反而更适合「低温射频」｜高温期客户效果追踪报告	\N	\N	f	ai	t	2026-08-09 14:00:21.894	2026-08-09 14:00:21.894
cmslvdwg6002ci5cxy0d4hckl	美业	topic	\N	\N	七夕不搞套路，我们把情侣护理室改成了「坦白局茶话会」｜现场录音整理成小红书热帖	\N	\N	f	ai	t	2026-08-09 14:00:21.895	2026-08-09 14:00:21.895
cmslvdwg7002di5cxpz4gl7ql	美业	topic	\N	\N	开学季妈妈群炸锅：产后斑真的能淡？我们调出3位二胎妈妈180天淡斑打卡全记录	\N	\N	f	ai	t	2026-08-09 14:00:21.896	2026-08-09 14:00:21.896
cmslvdwg9002ei5cxa9a20v75	美业	topic	\N	\N	中秋家宴前一周，发型师教你用3支发蜡搞定“被亲戚夸又不显用力”的发型	\N	\N	f	ai	t	2026-08-09 14:00:21.897	2026-08-09 14:00:21.897
cmslvdwga002fi5cxjlektkm6	美业	topic	\N	\N	国庆长假归来，皮肤科医生朋友帮我们验了店里所有毛巾的菌落总数（附检测报告截图）	\N	\N	f	ai	t	2026-08-09 14:00:21.898	2026-08-09 14:00:21.898
cmslvdwgb002hi5cx1g3xroad	美业	topic	\N	\N	立冬后第一波干痒脱皮？理疗师拿出三年客户数据：92%人忽略了“屏障升温术	\N	\N	f	ai	t	2026-08-09 14:00:21.9	2026-08-09 14:00:21.9
cmslvdwgc002ii5cxt3c0pid3	美业	topic	\N	\N	圣诞美甲翻车预警！我们扒了小红书爆款款式的实际持色天数（含洗手/做饭实测）	\N	\N	f	ai	t	2026-08-09 14:00:21.901	2026-08-09 14:00:21.901
cmslvdwgd002ji5cxwof3xzdc	美业	topic	\N	\N	元旦焕新不整容，3位35+客户选择「轮廓微调护理」的真实变化周期日志	\N	\N	f	ai	t	2026-08-09 14:00:21.902	2026-08-09 14:00:21.902
cmslvdwge002ki5cx8a0jf5nm	美业	topic	\N	\N	春节返乡前，剪发师拒绝接单的3种情况（附聊天截图）：不是不想赚，是真怕你后悔	\N	\N	f	ai	t	2026-08-09 14:00:21.903	2026-08-09 14:00:21.903
cmslvdwgf002li5cx4pk9wtki	美业	topic	\N	\N	情人节当天，我们暂停营业2小时，只为给10对老顾客补拍「结婚十年素颜合影」	\N	\N	f	ai	t	2026-08-09 14:00:21.903	2026-08-09 14:00:21.903
cmslvdwgf002mi5cxtven5ch5	美业	topic	\N	\N	惊蛰后湿气重、脸泛黄？中医师驻店那天，我们现场教你怎么辨认“假黄褐斑	\N	\N	f	ai	t	2026-08-09 14:00:21.904	2026-08-09 14:00:21.904
cmslvdwgg002ni5cx0md38huj	美业	topic	\N	\N	3·8节不推“女王套餐”，发起#我的美不需要折扣 话题，收集200+条真实女性自拍故事	\N	\N	f	ai	t	2026-08-09 14:00:21.904	2026-08-09 14:00:21.904
cmslvdwgg002oi5cxox731nsm	美业	topic	\N	\N	谷雨前后是祛痘黄金期？皮肤管理师带你看懂「痤疮丙酸杆菌活跃周期表」	\N	\N	f	ai	t	2026-08-09 14:00:21.905	2026-08-09 14:00:21.905
cmslvdwgh002pi5cxl9mdrqvc	美业	topic	\N	\N	五一调休那周，我们把消毒流程拍成vlog：从器械浸泡到紫外线灯照射全程无剪辑	\N	\N	f	ai	t	2026-08-09 14:00:21.905	2026-08-09 14:00:21.905
cmslvdwgh002qi5cxwmz0431f	美业	topic	\N	\N	端午艾草香薰护理上线，但先说清楚：它真不能驱蚊，但对熬夜脸真的有用	\N	\N	f	ai	t	2026-08-09 14:00:21.906	2026-08-09 14:00:21.906
cmslvdwgi002ri5cxdf89wo6z	美业	topic	\N	\N	暑期学生党专属｜凭学生证可领「防晒力测评」：测完才知道你涂的SPF50+根本没生效	\N	\N	f	ai	t	2026-08-09 14:00:21.906	2026-08-09 14:00:21.906
cmslvdwgj002si5cxvd78vyun	美业	topic	\N	\N	教师节特别企划：邀请5位老师分享“被粉笔灰+空调房偷走的胶原蛋白”自救方案	\N	\N	f	ai	t	2026-08-09 14:00:21.907	2026-08-09 14:00:21.907
cmslvdwgk002ti5cxkze2jpod	美业	topic	\N	\N	秋分后换季卡粉？我们拆解了客户最爱用的3款粉底液，在不同湿度下的持妆实测	\N	\N	f	ai	t	2026-08-09 14:00:21.908	2026-08-09 14:00:21.908
cmslvdwgk002ui5cx81yqvn95	美业	topic	\N	\N	双十二前夜，后台收到最多的问题是：“做完光电项目能马上敷面膜吗？”｜皮肤科医生答疑	\N	\N	f	ai	t	2026-08-09 14:00:21.909	2026-08-09 14:00:21.909
cmslvdwgl002vi5cxs9o0w5wh	美业	topic	\N	\N	大雪节气做肩颈，为什么比平时更易出痧？康复师现场讲解“寒凝血瘀”的可视化逻辑	\N	\N	f	ai	t	2026-08-09 14:00:21.91	2026-08-09 14:00:21.91
cmslvdwgm002wi5cxf2i99jb5	美业	topic	\N	\N	跨年夜不熬夜也能发光？我们给42位客户做了「节前急救护理」，平均提亮2.3个色号	\N	\N	f	ai	t	2026-08-09 14:00:21.91	2026-08-09 14:00:21.91
cmslvdwgn002xi5cxgdckhx8a	美业	topic	\N	\N	腊八节熬的不是粥，是我们熬了3年才调出的「面部角质代谢节奏表」（附自查指南）	\N	\N	f	ai	t	2026-08-09 14:00:21.911	2026-08-09 14:00:21.911
cmslve9ps002yi5cxh65bridq	美业	image_prompt	\N	\N	\N	一张干净明亮的ins风美容院前台特写，原木色接待台搭配绿植与香薰蜡烛，浅灰水泥地面与柔光落地窗，桌上摆放精致护肤品礼盒与手写欢迎卡，自然光影，柔和焦外	\N	f	ai	t	2026-08-09 14:00:39.087	2026-08-09 14:00:39.087
cmslve9pu002zi5cxjjd361z9	美业	image_prompt	\N	\N	\N	一张高清写实风格的美容产品陈列图，透明玻璃柜内整齐摆放10款国产精华液与面霜，瓶身标签清晰可见，背景为纯白无影墙，顶部柔光照明突出质地与光泽感	\N	f	ai	t	2026-08-09 14:00:39.09	2026-08-09 14:00:39.09
cmslve9pv0030i5cx8m6tedbx	美业	image_prompt	\N	\N	\N	一张国潮风护肤产品海报，青花瓷纹样边框环绕三款中药成分面膜，主视觉为水墨晕染的牡丹与灵芝图案，金色烫印“本草养颜”字样，红金配色喜庆又高级	\N	f	ai	t	2026-08-09 14:00:39.092	2026-08-09 14:00:39.092
cmslve9px0031i5cx5vy8qg8e	美业	image_prompt	\N	\N	\N	一张ins风美容院休息区全景，米白色布艺沙发配莫兰迪抱枕，墙面挂抽象艺术画与干花装饰，阳光透过纱帘洒在藤编茶几上的花果茶与预约本，氛围松弛治愈	\N	f	ai	t	2026-08-09 14:00:39.093	2026-08-09 14:00:39.093
cmslve9py0032i5cx848l5czt	美业	image_prompt	\N	\N	\N	一张写实风格的门店消毒间特写，不锈钢操作台面摆放紫外线消毒柜、一次性耗材密封盒、电子体温计与消毒记录表，穿白大褂技师戴口罩手套正在操作，环境洁净有序	\N	f	ai	t	2026-08-09 14:00:39.094	2026-08-09 14:00:39.094
cmslve9pz0033i5cxyyzjq8jk	美业	image_prompt	\N	\N	\N	一张国潮风美发沙龙门头设计图，朱红底色配金色祥云纹，招牌用书法体书写“云鬓雅集”，两侧立柱贴剪纸风格牡丹与凤凰图案，门前青砖地与灯笼点缀，传统不失现代	\N	f	ai	t	2026-08-09 14:00:39.096	2026-08-09 14:00:39.096
cmslve9q10034i5cxhgefzgn4	美业	image_prompt	\N	\N	\N	一张ins风双人美甲活动海报，浅粉渐变背景上悬浮两双手部特写（法式+跳色款式），中央手写字体“闺蜜同行·立减300”，右下角小字标注“限本周六日｜含护理+饮品”，清新活泼	\N	f	ai	t	2026-08-09 14:00:39.097	2026-08-09 14:00:39.097
cmslve9q20035i5cx11q0fkob	美业	image_prompt	\N	\N	\N	一张写实风格的周年庆活动现场图，店内悬挂丝带气球与定制横幅，顾客排队领取伴手礼（帆布包+试用装），工作人员微笑递送，真实人流与暖光灯营造热闹但不拥挤感	\N	f	ai	t	2026-08-09 14:00:39.098	2026-08-09 14:00:39.098
cmslve9q30036i5cx9fhzsn0p	美业	image_prompt	\N	\N	\N	一张国潮风母亲节感恩活动海报，墨色宣纸底纹上绘工笔萱草与银杏叶，中央烫金大字“妈妈的美，值得被认真对待”，下方列“孝心卡套餐：面部+肩颈+艾灸”，典雅有温度	\N	f	ai	t	2026-08-09 14:00:39.099	2026-08-09 14:00:39.099
cmslve9q40037i5cxt83oh5ch	美业	image_prompt	\N	\N	\N	一张ins风客户对比图拼贴，左半边素颜侧脸（柔焦处理）+右半边做完光子嫩肤后透亮肌肤特写，中间箭头标“28天真实变化”，底部手写体备注“无滤镜｜本人授权”，生活感强	\N	f	ai	t	2026-08-09 14:00:39.1	2026-08-09 14:00:39.1
cmslve9q50038i5cxzzpf48ru	美业	image_prompt	\N	\N	\N	一张写实风格的老客户回访现场照，40岁女性坐在理疗椅上做肩颈护理，技师手法清晰可见，她闭眼微笑，颈肩处敷着草本热敷包，背景是实时监测仪与整洁器械车，真实可信	\N	f	ai	t	2026-08-09 14:00:39.101	2026-08-09 14:00:39.101
cmslve9q60039i5cxn0dcqpcu	美业	image_prompt	\N	\N	\N	一张国潮风产后修复客户故事插画，水墨风格描绘三位不同年龄段妈妈：哺乳期、断奶期、育儿两年后，每人身旁标注“腹直肌修复｜盆底重建｜体态重塑”，配篆书标题“她的重启时刻	\N	f	ai	t	2026-08-09 14:00:39.103	2026-08-09 14:00:39.103
cmslve9q7003ai5cxpnxdpfgz	美业	image_prompt	\N	\N	\N	一张ins风傍晚美容院窗景，暖黄灯光从落地窗透出，窗外梧桐树影婆娑，窗内一盏台灯照亮翻开的《皮肤科医生笔记》，旁边放着玫瑰花茶与未拆封的体验卡，安静有故事感	\N	f	ai	t	2026-08-09 14:00:39.104	2026-08-09 14:00:39.104
cmslverj2004hi5cxk0xo2hh2	餐饮	title	对比	对比	我妈说这家糖水比她当年坐月子喝的还暖	\N	\N	f	ai	t	2026-08-09 14:01:02.174	2026-08-09 14:01:02.174
cmslve9q8003bi5cxvmx4eh3t	美业	image_prompt	\N	\N	\N	一张写实风格的晨间消毒准备镜头，晨光中技师用酒精喷雾擦拭美容床，床单洁白平整，枕套印有店名刺绣，镜面墙映出整齐排列的毛巾架与紫外线灯开启状态，细节扎实	\N	f	ai	t	2026-08-09 14:00:39.105	2026-08-09 14:00:39.105
cmslve9q9003ci5cxfi4isyf9	美业	image_prompt	\N	\N	\N	一张国潮风冬日暖愈氛围图，红梅枝干斜入画面，背景为暖灰砖墙与木质格栅，前景一张铺着苏绣棉垫的理疗床，床头摆铜制熏香炉袅袅轻烟，题字“一隅温养，自在生光	\N	f	ai	t	2026-08-09 14:00:39.106	2026-08-09 14:00:39.106
cmslveri4003di5cxhdwrc6ox	餐饮	title	数字	数字	38元吃撑！本地人私藏的牛肉面馆，汤底熬足12小时	\N	\N	f	ai	t	2026-08-09 14:01:02.14	2026-08-09 14:01:02.14
cmslveri6003ei5cx27kjxfpr	餐饮	title	反差	反差	人均45吃到扶墙出？这家藏在菜市场里的烧腊档火了3年	\N	\N	f	ai	t	2026-08-09 14:01:02.142	2026-08-09 14:01:02.142
cmslveri7003fi5cxnjvk73wb	餐饮	title	疑问	疑问	老板说这碗粉不加味精”——我偷偷查了进货单	\N	\N	f	ai	t	2026-08-09 14:01:02.143	2026-08-09 14:01:02.143
cmslveri8003gi5cx7qn3p56m	餐饮	title	痛点	痛点	为什么90%来打卡的年轻人，最后都成了储值会员？	\N	\N	f	ai	t	2026-08-09 14:01:02.144	2026-08-09 14:01:02.144
cmslveri9003hi5cxe1chceye	餐饮	title	福利	福利	凌晨2点还在排队？这条老街唯一通宵营业的砂锅粥铺	\N	\N	f	ai	t	2026-08-09 14:01:02.145	2026-08-09 14:01:02.145
cmslveria003ii5cx6esyhky5	餐饮	title	权威数据	权威数据	这碗酸辣粉，让3个外卖员吃完当场辞职去学手艺	\N	\N	f	ai	t	2026-08-09 14:01:02.147	2026-08-09 14:01:02.147
cmslverib003ji5cxjuidz68k	餐饮	title	悬念	悬念	大学城后巷最脏的店，却挂着「卫生示范单位」红牌	\N	\N	f	ai	t	2026-08-09 14:01:02.148	2026-08-09 14:01:02.148
cmslverid003ki5cx29lhmrgz	餐饮	title	共情	共情	老板娘边炒菜边哭：“再没人来，这锅就真砸了	\N	\N	f	ai	t	2026-08-09 14:01:02.149	2026-08-09 14:01:02.149
cmslverid003li5cxiwzza8c5	餐饮	title	故事	故事	深圳打工人的第7次搬家，行李里还装着这家店的辣椒酱	\N	\N	f	ai	t	2026-08-09 14:01:02.15	2026-08-09 14:01:02.15
cmslverie003mi5cx6j4u5jl9	餐饮	title	清单	清单	我妈尝完直接微信转账200：“明早带全家来！	\N	\N	f	ai	t	2026-08-09 14:01:02.151	2026-08-09 14:01:02.151
cmslverih003ni5cxqgetu04n	餐饮	title	热点	热点	抖音爆火的“墨鱼汁拌面”，本地人早就吃腻了？	\N	\N	f	ai	t	2026-08-09 14:01:02.153	2026-08-09 14:01:02.153
cmslverih003oi5cxcqd16ndi	餐饮	title	对比	对比	大众点评TOP1的烤鱼店，差评里藏着3个惊人真相	\N	\N	f	ai	t	2026-08-09 14:01:02.154	2026-08-09 14:01:02.154
cmslverii003pi5cxpvjt6zwq	餐饮	title	对比	对比	比海底捞便宜一半，服务却更像米其林”？实测对比图来了	\N	\N	f	ai	t	2026-08-09 14:01:02.155	2026-08-09 14:01:02.155
cmslverij003qi5cxepi4y4fq	餐饮	title	对比	对比	隔壁王姨连吃21天不重样，她家小炒肉到底有啥魔力？	\N	\N	f	ai	t	2026-08-09 14:01:02.155	2026-08-09 14:01:02.155
cmslverik003ri5cxme29kp8h	餐饮	title	对比	对比	团购价=成本价？我们扒了老板后台流水单（附截图）	\N	\N	f	ai	t	2026-08-09 14:01:02.156	2026-08-09 14:01:02.156
cmslverik003si5cxknqwj8k8	餐饮	title	对比	对比	开业3个月，外卖单量涨400%”——95后夫妻的早餐铺逆袭记	\N	\N	f	ai	t	2026-08-09 14:01:02.157	2026-08-09 14:01:02.157
cmslveril003ti5cx2awczr03	餐饮	title	对比	对比	他辞掉银行工作，在城中村开了家只卖3道菜的饭馆	\N	\N	f	ai	t	2026-08-09 14:01:02.158	2026-08-09 14:01:02.158
cmslverim003ui5cxw7gheomp	餐饮	title	对比	对比	6㎡厨房养活3口人：凌晨4点的肠粉摊，蒸汽里全是光	\N	\N	f	ai	t	2026-08-09 14:01:02.158	2026-08-09 14:01:02.158
cmslverin003vi5cxn9vzgizr	餐饮	title	对比	对比	女儿高考前夜，她把最后一份卤牛肉送给了隔壁考生	\N	\N	f	ai	t	2026-08-09 14:01:02.159	2026-08-09 14:01:02.159
cmslverio003wi5cxayv03uqk	餐饮	title	对比	对比	别拍我，手抖”——58岁老师傅切了43年叉烧，刀工仍稳如尺	\N	\N	f	ai	t	2026-08-09 14:01:02.16	2026-08-09 14:01:02.16
cmslverip003xi5cx9f1efw90	餐饮	title	对比	对比	2024广州最值得N刷的5家苍蝇馆子（附暗号菜单）	\N	\N	f	ai	t	2026-08-09 14:01:02.161	2026-08-09 14:01:02.161
cmslveriq003yi5cxz52w309e	餐饮	title	对比	对比	打工人周末必冲！天河5家「不排队+不踩雷」晚餐清单	\N	\N	f	ai	t	2026-08-09 14:01:02.162	2026-08-09 14:01:02.162
cmslverir003zi5cxbqg8xmyk	餐饮	title	对比	对比	本地阿姨严选：孩子爱吃、老公不挑、婆婆夸干净的8家店	\N	\N	f	ai	t	2026-08-09 14:01:02.163	2026-08-09 14:01:02.163
cmslveris0040i5cxkh4ba0iw	餐饮	title	对比	对比	端午聚餐不翻车指南：6家能订整桌、送粽子、免打包费的馆子	\N	\N	f	ai	t	2026-08-09 14:01:02.164	2026-08-09 14:01:02.164
cmslverit0041i5cxo0ds2cst	餐饮	title	对比	对比	深夜饿醒救命清单：珠江新城/北京路/江南西，3公里内真实可约	\N	\N	f	ai	t	2026-08-09 14:01:02.166	2026-08-09 14:01:02.166
cmslveriu0042i5cx5b30tcql	餐饮	title	对比	对比	《舌尖上的中国》导演路过顺手拍了3分钟，没播但火了	\N	\N	f	ai	t	2026-08-09 14:01:02.166	2026-08-09 14:01:02.166
cmslveriu0043i5cx4eophbhj	餐饮	title	对比	对比	五一假期本地热搜第2：全城找“会跳舞的虾滑”在哪	\N	\N	f	ai	t	2026-08-09 14:01:02.167	2026-08-09 14:01:02.167
cmslveriv0044i5cxzce2ci6v	餐饮	title	对比	对比	端午限定！龙舟水煮的荔枝木烧鹅，仅售88只	\N	\N	f	ai	t	2026-08-09 14:01:02.168	2026-08-09 14:01:02.168
cmslveriw0045i5cx74rqa4ju	餐饮	title	对比	对比	暴雨天订单暴涨200%，原来他们家的煲仔饭会“冒仙气	\N	\N	f	ai	t	2026-08-09 14:01:02.168	2026-08-09 14:01:02.168
cmslveriw0046i5cxl78lzior	餐饮	title	对比	对比	跟风买网红冰淇淋翻车后，我试了这5款本地人真吃的雪糕	\N	\N	f	ai	t	2026-08-09 14:01:02.169	2026-08-09 14:01:02.169
cmslverix0047i5cxm3q8oy5j	餐饮	title	对比	对比	城中村15元盖饭 vs CBD 68元轻食沙拉，热量低30%还多两块肉	\N	\N	f	ai	t	2026-08-09 14:01:02.169	2026-08-09 14:01:02.169
cmslverix0048i5cxnsu2d7d9	餐饮	title	对比	对比	学生党外卖榜TOP1 vs 上班族午休榜TOP1，竟是一家店	\N	\N	f	ai	t	2026-08-09 14:01:02.17	2026-08-09 14:01:02.17
cmslveriy0049i5cx3dq2llgq	餐饮	title	对比	对比	隔壁新开的日料人均298，它家同款三文鱼刺身只要39	\N	\N	f	ai	t	2026-08-09 14:01:02.17	2026-08-09 14:01:02.17
cmslveriy004ai5cxe6z1gw0l	餐饮	title	对比	对比	比我家楼下贵5块”？我们测了12家黄焖鸡米饭的鸡肉克重	\N	\N	f	ai	t	2026-08-09 14:01:02.171	2026-08-09 14:01:02.171
cmslveriz004bi5cxtk0t4csx	餐饮	title	对比	对比	老字号早茶38元一笼虾饺 vs 新派茶楼68元，谁家虾多？实测	\N	\N	f	ai	t	2026-08-09 14:01:02.171	2026-08-09 14:01:02.171
cmslveriz004ci5cxdivk9wsd	餐饮	title	对比	对比	38℃高温天，他们家冰镇杨梅酒卖断货	\N	\N	f	ai	t	2026-08-09 14:01:02.172	2026-08-09 14:01:02.172
cmslverj0004di5cxdq53ncxg	餐饮	title	对比	对比	老板说今天不打烊，等最后一个加班的人	\N	\N	f	ai	t	2026-08-09 14:01:02.172	2026-08-09 14:01:02.172
cmslverj0004ei5cxy7ildku1	餐饮	title	对比	对比	这盘辣子鸡里，我数出137粒花生米	\N	\N	f	ai	t	2026-08-09 14:01:02.173	2026-08-09 14:01:02.173
cmslverj1004fi5cxr7jzpytw	餐饮	title	对比	对比	扫码点单后，手机弹出一句‘今天少放盐，记得吗？’	\N	\N	f	ai	t	2026-08-09 14:01:02.173	2026-08-09 14:01:02.173
cmslverj1004gi5cxwr14fkpy	餐饮	title	对比	对比	收银台抽屉里，压着32张手写感谢卡	\N	\N	f	ai	t	2026-08-09 14:01:02.174	2026-08-09 14:01:02.174
cmslwujjo00cei5hcn5x0ez9b	婚庆摄影	article	会员权益	\N	\N	▫️修图时绝对不能动哪个部位？	\N	f	ai	t	2026-08-09 14:41:17.941	2026-08-09 14:41:17.941
cmslverj4004ii5cxp9bgp5qm	餐饮	title	对比	对比	第一次约会点了3次同一道菜，他后来成了我老公	\N	\N	f	ai	t	2026-08-09 14:01:02.176	2026-08-09 14:01:02.176
cmslverj4004ji5cx2d7au64p	餐饮	title	对比	对比	带娃崩溃时，店员默默端来一碗热乎乎的南瓜羹	\N	\N	f	ai	t	2026-08-09 14:01:02.177	2026-08-09 14:01:02.177
cmslverj5004ki5cxb8h498vu	餐饮	title	对比	对比	失业那周，老板让我免费吃7天，只换我擦一周桌子	\N	\N	f	ai	t	2026-08-09 14:01:02.177	2026-08-09 14:01:02.177
cmslverj5004li5cxbi0evrxk	餐饮	title	对比	对比	高考查分那天，我在他家酸汤鱼里捞到一张纸条：稳过	\N	\N	f	ai	t	2026-08-09 14:01:02.178	2026-08-09 14:01:02.178
cmslverj6004mi5cx4y9nta2f	餐饮	title	对比	对比	3年没涨价的猪脚饭，老板说‘涨了怕你们吃不起’	\N	\N	f	ai	t	2026-08-09 14:01:02.179	2026-08-09 14:01:02.179
cmslverj7004ni5cxdmqsmlll	餐饮	title	对比	对比	每天现炸的油条，冷了就倒掉——监控拍下全过程	\N	\N	f	ai	t	2026-08-09 14:01:02.18	2026-08-09 14:01:02.18
cmslverj8004oi5cxue75l7xl	餐饮	title	对比	对比	不用预约、不搞噱头、不玩滤镜，就靠这口锅气活着	\N	\N	f	ai	t	2026-08-09 14:01:02.181	2026-08-09 14:01:02.181
cmslverj9004pi5cxf6qyvuos	餐饮	title	对比	对比	2002年开业至今，菜单只有1张A4纸，字迹越写越淡	\N	\N	f	ai	t	2026-08-09 14:01:02.181	2026-08-09 14:01:02.181
cmslverj9004qi5cxrvkhlr6f	餐饮	title	对比	对比	没有WiFi密码，但每桌都贴着‘慢慢吃，不赶人’	\N	\N	f	ai	t	2026-08-09 14:01:02.182	2026-08-09 14:01:02.182
cmslverja004ri5cxjgv6qfuw	餐饮	title	对比	对比	五一排队2小时？我们找到3家免等位的平替神店	\N	\N	f	ai	t	2026-08-09 14:01:02.183	2026-08-09 14:01:02.183
cmslverjb004si5cxwzjhsk62	餐饮	title	对比	对比	比‘外婆家’便宜，比‘绿茶’热闹，比‘南京大牌档’烟火气足	\N	\N	f	ai	t	2026-08-09 14:01:02.183	2026-08-09 14:01:02.183
cmslverjb004ti5cxw2k702rz	餐饮	title	对比	对比	不是网红，胜似网红：一家连招牌都没有的炖汤铺	\N	\N	f	ai	t	2026-08-09 14:01:02.184	2026-08-09 14:01:02.184
cmslverjc004ui5cxw7jk1qh7	餐饮	title	对比	对比	在深圳，吃顿好的≠要排队≠要拍照≠要发朋友圈	\N	\N	f	ai	t	2026-08-09 14:01:02.184	2026-08-09 14:01:02.184
cmslverjc004vi5cxquuw4nbg	餐饮	title	对比	对比	不靠装修靠味道，不开连锁不开分店，就守着这条街	\N	\N	f	ai	t	2026-08-09 14:01:02.185	2026-08-09 14:01:02.185
cmslverjd004wi5cxoarv5p07	餐饮	title	对比	对比	上周被投诉‘太咸’，老板连夜改配方，今天试吃免费	\N	\N	f	ai	t	2026-08-09 14:01:02.185	2026-08-09 14:01:02.185
cmslverjd004xi5cx456i3a7g	餐饮	title	对比	对比	暴雨停运地铁那晚，他们用三轮车送了86份热饭	\N	\N	f	ai	t	2026-08-09 14:01:02.186	2026-08-09 14:01:02.186
cmslverje004yi5cx9poqfr9b	餐饮	title	对比	对比	高考季免费提供休息区+充电+打印准考证，	\N	\N	f	ai	t	2026-08-09 14:01:02.186	2026-08-09 14:01:02.186
cmslvfqhz004zi5cxqb6sd56s	餐饮	article	新客引流	\N	\N	新客引流：今天第一次来？扫码领「新人尝鲜券」——酸汤肥牛+冰粉立减38元！后厨明档看得见，师傅现切现烫，酸香开胃不腻口。我们不做预制菜，只做你妈夸“比家里煮得还香”的那口热乎气。别信网红滤镜，来吃真实烟火气，吃完觉得值，再带朋友来。（附实拍灶台翻炒视频截图）	\N	f	ai	t	2026-08-09 14:01:47.494	2026-08-09 14:01:47.494
cmslvfqi20050i5cx1mgomjpn	餐饮	article	老客复购	\N	\N	新客引流：刷到这条，说明你和我们有缘！凭此条到店，免费送【手打柠檬茶+脆皮五花肉小份】，限前50名。老板说：“新朋友第一顿，必须吃得踏实、笑得开心。”所有食材每日凌晨4点直采，牛肉当天现切，酸汤每天现熬6小时。不怕你对比，就怕你吃完不发朋友圈。	\N	f	ai	t	2026-08-09 14:01:47.498	2026-08-09 14:01:47.498
cmslvfqi40051i5cxrz4us46v	餐饮	article	产品种草	\N	\N	新客引流：不是所有“本地人气店”都敢让你推门就坐——我们取消预约制，空位实时更新在大众点评。今天到店报暗号“刚刷到你”，直接升级双人套餐（赠溏心蛋+秘制辣酱），还送手写感谢卡。试试看：热汤上桌3秒冒泡，牛肉滑嫩到筷子夹不住，这口鲜，值得你绕三条街。	\N	f	ai	t	2026-08-09 14:01:47.5	2026-08-09 14:01:47.5
cmslvfqi50052i5cxtps3jazq	餐饮	article	客户见证	\N	\N	老客复购：上周王姐带婆婆来吃了三次，今天又带闺蜜来——她说：“我妈现在每周三雷打不动点咱家酸汤外卖。”老客专属「回头香」计划启动：每消费满200，自动存15元无门槛券，月底清零前还能叠加用！你常来，我们才敢把压箱底的猪肚鸡浓汤配方，悄悄加进你的碗里。	\N	f	ai	t	2026-08-09 14:01:47.501	2026-08-09 14:01:47.501
cmslvfqi60053i5cxzqbvisc2	餐饮	article	节假日活动	\N	\N	老客复购：熟客不用点单，小哥一见你就喊“老位置，酸汤加辣，毛肚多烫10秒？”——这才是我们最骄傲的VIP待遇。即日起，老客生日当周，整桌免单（限堂食）+手写贺卡+老板亲自敬一杯米酒。不靠会员等级，靠你脸熟、口味熟、连你娃爱蘸啥酱我们都记得。	\N	f	ai	t	2026-08-09 14:01:47.502	2026-08-09 14:01:47.502
cmslvfqi60054i5cxpdu1easq	餐饮	article	品牌故事	\N	\N	老客复购：你可能没注意：每次结账小票右下角，都有个手绘小辣椒印章。集满8枚，换全年无限次【酸汤免费续汤+毛肚半价】。不是套路，是老板贴在收银台的便签：“李哥，您上月来了12次，汤底我多熬了半小时——谢谢您把这儿当食堂。	\N	f	ai	t	2026-08-09 14:01:47.503	2026-08-09 14:01:47.503
cmslvfqi70055i5cxfkocc7uu	餐饮	article	上新公告	\N	\N	产品种草：实拍！凌晨5点菜场抢的贵州红酸汤底料+云南野生木姜子+广西金桔汁，三地发酵18天，才熬出这一锅透亮红汤。涮毛肚7秒脆、黄喉12秒弹、肥牛卷边微卷就捞——不信？抖音搜#XX酸汤慢镜头，1080P看清每片肉在汤里跳舞。	\N	f	ai	t	2026-08-09 14:01:47.504	2026-08-09 14:01:47.504
cmslvfqi80056i5cxk5vp0lmv	餐饮	article	优惠活动	\N	\N	产品种草：别再问“为啥别家酸汤发黑发苦”——我们拆给你看：0添加山梨酸钾，0香精，0骨汤膏。真材实料只有三样：老坛酸汤、牛骨高汤、现榨青柠汁。喝一口像咬破山野清晨的露水，酸得清爽，香得通透。试过就知道：好味道，从来不用遮。	\N	f	ai	t	2026-08-09 14:01:47.504	2026-08-09 14:01:47.504
cmslvfqi90057i5cxu8b98avm	餐饮	article	知识科普	\N	\N	产品种草：这锅酸汤，老板熬了9年，换了7版配方，最后定稿是“孩子能喝、老人能涮、减肥党敢连喝三碗”。汤底自带回甘，涮完蔬菜不涩、豆腐不散、粉丝吸饱汤还不坨。今天下单团购，送同款酸汤料包（附老板手写熬制指南），在家也能复刻你爱的那一口。	\N	f	ai	t	2026-08-09 14:01:47.505	2026-08-09 14:01:47.505
cmslvfqia0058i5cx4bv8trwx	餐饮	article	互动话题	\N	\N	客户见证：@杭州阿哲（抖音粉丝2.4w）探店视频爆了：“在杭州吃过的最正酸汤，毛肚脆过薯片！”评论区炸出372条本地人留言：“我妈让我替她订明早外送”“公司团建连订5天”“孕晚期狂点酸汤配米饭”。真实截图已贴在门口玻璃上。	\N	f	ai	t	2026-08-09 14:01:47.506	2026-08-09 14:01:47.506
cmslvfqia0059i5cx4h5xsgfz	餐饮	article	答疑辟谣	\N	\N	客户见证：顾客手写感谢卡墙快贴不下了：有高考结束全家来庆祝的、有术后康复第一顿出门吃饭的、还有异地男友空运酸汤料包给女友的……最新一张写着：“化疗第三期，终于胃口开了——谢谢你们的汤，暖得像回家。”（附泛黄卡片实拍）	\N	f	ai	t	2026-08-09 14:01:47.507	2026-08-09 14:01:47.507
cmslvfqib005ai5cx1i0f5vzy	餐饮	article	会员权益	\N	\N	客户见证：大众点评最新50条带图好评，47条提到“汤底能喝光”“服务员记得我不要香菜”“打包盒盖严实没漏汤”。其中一条高赞说：“在这里吃饭，像被邻居阿姨投喂——不推销、不催单、结账时多塞两颗话梅。”我们不做流量生意，只做回头饭桌。	\N	f	ai	t	2026-08-09 14:01:47.508	2026-08-09 14:01:47.508
cmslvfqic005bi5cxb9j1xf47	餐饮	article	会员权益	\N	\N	节假日活动：中秋不搞虚的！团圆桌专享：点任意锅底，送【桂花酿圆子×2+手作月饼盲盒】，月饼馅是老板娘手调的梅干菜肉松+桂花豆沙。带老人孩子来，加10元换「软糯无骨鸡爪+温热银耳羹」。团圆，不在排面，在这口温热踏实里。	\N	f	ai	t	2026-08-09 14:01:47.509	2026-08-09 14:01:47.509
cmslvfqie005ci5cxmii148tg	餐饮	article	会员权益	\N	\N	节假日活动：国庆七天，每天前20桌送【手绘城市地图餐垫+方言祝福语音卡】（扫码听老板用杭州话/宁波话/温州话祝你“吃得落胃”）。带娃家庭额外赠「酸汤小厨师体验包」：围裙+小锅+可食用彩米，孩子自己舀汤，成就感拉满！	\N	f	ai	t	2026-08-09 14:01:47.51	2026-08-09 14:01:47.51
cmslvfqif005di5cxir1qfo3e	餐饮	article	会员权益	\N	\N	节假日活动：跨年夜我们营业到凌晨2点！点单满299，送【手写福字窗花+暖手酸梅汤】，汤里浮着三颗陈皮话梅，酸甜暖胃不齁。最后一桌客人，老板亲自下厨炒一道“年年有余”（醋熘鱼片），不拍照、不直播，只为你跨年那一刻，热气腾腾的安心。	\N	f	ai	t	2026-08-09 14:01:47.512	2026-08-09 14:01:47.512
cmslvfqig005ei5cxb2e325kq	餐饮	article	会员权益	\N	\N	品牌故事：2015年，老板辞掉互联网offer，在城西租下8㎡小店。第一锅酸汤熬糊了3次，房东差点赶人。直到遇见贵州苗寨阿婆，教他用陶瓮封坛、山泉水养菌——现在店里12口老瓮，编号001的还在用。烟火气不是口号，是十年没换过的灶台、磨亮的锅铲、和越熬越醇的汤。	\N	f	ai	t	2026-08-09 14:01:47.513	2026-08-09 14:01:47.513
cmslvfqih005fi5cxl4iw1jnr	餐饮	article	会员权益	\N	\N	品牌故事：老板娘原是三甲医院营养师，辞职那天说：“我想做让人吃得安心的饭。”现在菜单每道菜标热量&嘌呤值，酸汤钠含量比市面低37%，连蘸料都用无麸质酱油调。墙上挂着她手写的《肠胃友好清单》：“痛风朋友可放心涮毛肚，孕妇推荐山药滑肉片。	\N	f	ai	t	2026-08-09 14:01:47.513	2026-08-09 14:01:47.513
cmslvfqii005gi5cxqaxy9hr9	餐饮	article	会员权益	\N	\N	品牌故事：小店没logo，门头只挂一块旧木牌，刻着“酸汤·家”二字。为什么？老板说：“我爸当年挑着担子卖酸汤，走街串巷，人们叫他‘酸汤阿伯’。现在我们想让每个进门的人，都像回阿伯家吃饭——不讲规矩，只管吃饱、聊透、笑着走。	\N	f	ai	t	2026-08-09 14:01:47.514	2026-08-09 14:01:47.514
cmslvfqij005hi5cxlen32x30	餐饮	article	会员权益	\N	\N	上新公告：重磅上新！「雪菜臭鳜鱼酸汤锅」来了——黄山臭鳜鱼经36小时控温发酵，去腥留鲜；宁波雪菜手剁碎末，和酸汤碰撞出山海之鲜。首周试吃价58元（原价88），前100名送【臭鳜鱼酥+雪菜油渣拌饭】。闻着微臭，入口爆鲜，老饕已排队等开锅！	\N	f	ai	t	2026-08-09 14:01:47.515	2026-08-09 14:01:47.515
cmslvfqij005ii5cxyyx8m5ka	餐饮	article	会员权益	\N	\N	上新公告：今早刚到的云南高山菌，限时上线「菌菇酸汤轻食锅」：鹿茸菇+鸡枞+奶浆菌，0牛油0辣椒，汤色金黄清透，喝得出阳光雨露味。配藜麦饭+溏心蛋，热量仅426kcal。健身党/控糖族/哺乳期妈妈，这锅汤，我们熬得比你算卡路里还认真。	\N	f	ai	t	2026-08-09 14:01:47.516	2026-08-09 14:01:47.516
cmslvfqik005ji5cxjclgpucj	餐饮	article	会员权益	\N	\N	上新公告：深夜上新！11点后到店，解锁「宵夜限定·酸汤煨面」：手擀碱水面+每日现拆蟹粉+酸汤底煨足20分钟，撒一把葱酥，滴两滴麻油。面韧汤浓，蟹香混着酸香直冲天灵盖。抖音搜#XX深夜面，看凌晨1点厨房灯还亮着——胃饿了，我们醒着。	\N	f	ai	t	2026-08-09 14:01:47.517	2026-08-09 14:01:47.517
cmslvfqil005ki5cxtdpkahud	餐饮	article	会员权益	\N	\N	优惠活动：本周拼手速！抖音团购爆款【双人酸汤锅套餐】直降42元，只要98！含：酸汤锅底+毛肚+肥牛+鸭血+冻豆腐+手打柠檬茶×2。重点：券含「免排队特权」——到店出示，插队优先涮！库存仅300份，售罄即恢复原价，手慢真无！	\N	f	ai	t	2026-08-09 14:01:47.517	2026-08-09 14:01:47.517
cmslvfqim005li5cxxp0nv5zc	餐饮	article	会员权益	\N	\N	优惠活动：学生党看这里！凭学生证/校园卡，全天享「学生专享价」：酸汤锅底+基础荤素+冰粉=68元（原价98）。另赠【复习能量包】：提神薄荷糖+错题本贴纸+手写鼓励便签。读书很苦，但吃饭不能将就——我们请客，陪你熬过每一个ddl。	\N	f	ai	t	2026-08-09 14:01:47.518	2026-08-09 14:01:47.518
cmslvfqin005mi5cxdpjvn7qp	餐饮	article	会员权益	\N	\N	优惠活动：周三会员日，全场菜品5折！不是部分，是全部（酒水除外）。为什么选周三？老板说：“一周中间，最需要一口热乎。”当天到店，还送【周三治愈包】：暖手宝造型冰粉杯+解压捏捏乐+一句随机暖心话。折扣真，心意更真。	\N	f	ai	t	2026-08-09 14:01:47.519	2026-08-09 14:01:47.519
cmslvfqin005ni5cxembteaa2	餐饮	article	会员权益	\N	\N	知识科普：酸汤越酸越好？错！真正好酸汤靠乳酸菌自然发酵，pH值稳定在3.8-4.2——太酸伤胃，太淡失魂。我们每锅出锅前测pH值，达标才上桌。不信？下次来，带你看看检测仪数字跳动的样子。	\N	f	ai	t	2026-08-09 14:01:47.52	2026-08-09 14:01:47.52
cmslvfqio005oi5cxrs2w1yu4	餐饮	article	会员权益	\N	\N	知识科普：毛肚为啥要“七上八下”？因为7秒表层蛋白质凝固锁住汁水，8秒内里仍嫩。涮超10秒变橡皮筋！我们培训服务员必须盯秒表——不是较真，是怕你错过那一口“脆中带润”的黄金时刻。	\N	f	ai	t	2026-08-09 14:01:47.521	2026-08-09 14:01:47.521
cmslvfqip005pi5cxbb6bvw8u	餐饮	article	会员权益	\N	\N	知识科普：酸汤能养胃？对！优质发酵酸汤含活性益生菌+有机酸，助消化、稳菌群。但前提是：不加防腐剂、不勾芡、不兑高汤膏。我们的检测报告贴在明档玻璃上，菌群数≥1.2×10⁸CFU/mL，喝得见真章。	\N	f	ai	t	2026-08-09 14:01:47.521	2026-08-09 14:01:47.521
cmslvfqip005qi5cxwemomqzp	餐饮	article	会员权益	\N	\N	互动话题：评论区接龙！你人生中最上头的一口酸，是什么味道？	\N	f	ai	t	2026-08-09 14:01:47.522	2026-08-09 14:01:47.522
cmslvfqiq005ri5cx37vojaje	餐饮	article	会员权益	\N	\N	👉 我先来：初中校门口酸梅粉拌冰棍，酸得眼泪直流却停不下嘴…	\N	f	ai	t	2026-08-09 14:01:47.522	2026-08-09 14:01:47.522
cmslvfqiq005si5cxl78he0eg	餐饮	article	会员权益	\N	\N	抽10位走心留言，	\N	f	ai	t	2026-08-09 14:01:47.523	2026-08-09 14:01:47.523
cmslvg2wd005ti5cxglxo2f2c	餐饮	topic	\N	\N	春日踏青季｜5家藏在公园边的野餐级小馆，自带餐垫+免费打包盒	\N	\N	f	ai	t	2026-08-09 14:02:03.565	2026-08-09 14:02:03.565
cmslvg2wf005ui5cxmeggmqzo	餐饮	topic	\N	\N	清明青团季｜本地老师傅手作青团实测：哪家软糯不腻？附隐藏豆沙加倍攻略	\N	\N	f	ai	t	2026-08-09 14:02:03.567	2026-08-09 14:02:03.567
cmslvg2wg005vi5cxo69ovw72	餐饮	topic	\N	\N	五一出游潮｜火车站/景区旁这7家“救命食堂”，人均40吃饱还送热水壶	\N	\N	f	ai	t	2026-08-09 14:02:03.568	2026-08-09 14:02:03.568
cmslvg2wh005wi5cxmt9o6uy2	餐饮	topic	\N	\N	端午前哨战｜3家现包肉粽摊位蹲点记录：凌晨4点的糯米香vs真空粽差在哪	\N	\N	f	ai	t	2026-08-09 14:02:03.569	2026-08-09 14:02:03.569
cmslvg2wh005xi5cxyk0mdy2j	餐饮	topic	\N	\N	618年中囤货｜火锅店老板把底料当零食卖？试吃后发现能拌面还能炒饭	\N	\N	f	ai	t	2026-08-09 14:02:03.57	2026-08-09 14:02:03.57
cmslvg2wi005yi5cx54i8v310	餐饮	topic	\N	\N	毕业季限定｜大学城后巷的10元盖饭江湖：学生党私藏菜单+暗号打折	\N	\N	f	ai	t	2026-08-09 14:02:03.57	2026-08-09 14:02:03.57
cmslvg2wj005zi5cxosxdljv1	餐饮	topic	\N	\N	高温预警实录｜空调开到16℃的冷面馆，冰镇辣白菜+手擀面爽到打颤	\N	\N	f	ai	t	2026-08-09 14:02:03.571	2026-08-09 14:02:03.571
cmslvg2wj0060i5cx0kqeflty	餐饮	topic	\N	\N	七夕避坑指南｜本地人绝不带对象去的5家“网红烛光餐厅”（附真爱推荐3家）	\N	\N	f	ai	t	2026-08-09 14:02:03.572	2026-08-09 14:02:03.572
cmslvg2wk0061i5cx810ntouo	餐饮	topic	\N	\N	暑假亲子档｜儿童餐免单但要求孩子画张画？这家餐厅墙上贴满 crayon 涂鸦	\N	\N	f	ai	t	2026-08-09 14:02:03.573	2026-08-09 14:02:03.573
cmslvg2wl0062i5cxbhcozj3j	餐饮	topic	\N	\N	立秋啃秋膘｜全城搜罗脆皮烤鸭店：鸭架熬汤免费续、鸭饼薄到透光哪家赢	\N	\N	f	ai	t	2026-08-09 14:02:03.573	2026-08-09 14:02:03.573
cmslvg2wl0063i5cx0fc9ck8p	餐饮	topic	\N	\N	开学报到日｜校门口奶茶店凌晨3点排队做珍珠，黑糖浆温度刚好的秘密	\N	\N	f	ai	t	2026-08-09 14:02:03.574	2026-08-09 14:02:03.574
cmslvg2wm0064i5cxzwr8gjme	餐饮	topic	\N	\N	中秋前夜｜月饼模具DIY工坊爆满！95后老板：今年卖断货的是梅干菜肉馅	\N	\N	f	ai	t	2026-08-09 14:02:03.575	2026-08-09 14:02:03.575
cmslvg2wn0065i5cx8qm12m5m	餐饮	topic	\N	\N	国庆长假｜高速服务区美食逆袭榜：这4家本地连锁店比市区还地道	\N	\N	f	ai	t	2026-08-09 14:02:03.575	2026-08-09 14:02:03.575
cmslvg2wo0066i5cxcdx7459a	餐饮	topic	\N	\N	重阳敬老局｜社区食堂老人专属时段实拍：65岁起2元吃热汤+免费切配服务	\N	\N	f	ai	t	2026-08-09 14:02:03.576	2026-08-09 14:02:03.576
cmslvg2wo0067i5cxopj1nnu0	餐饮	topic	\N	\N	双11反向操作｜餐厅上线“囤菜券”：19.9囤10斤毛肚，过期自动转成储值金	\N	\N	f	ai	t	2026-08-09 14:02:03.577	2026-08-09 14:02:03.577
cmslvg2wp0068i5cxueyuo5ij	餐饮	topic	\N	\N	初雪首日｜街角热红酒摊爆火：苹果片煮到透明、肉桂棒能嚼着吃的真实体验	\N	\N	f	ai	t	2026-08-09 14:02:03.577	2026-08-09 14:02:03.577
cmslvg2wp0069i5cx1c5r76xd	餐饮	topic	\N	\N	元旦跨年夜｜24小时营业的饺子铺，凌晨三点坐满等倒数的打工人和情侣	\N	\N	f	ai	t	2026-08-09 14:02:03.578	2026-08-09 14:02:03.578
cmslvg2wq006ai5cxb5ac44zf	餐饮	topic	\N	\N	腊八节限定｜免费腊八蒜+粥摊排到巷口，老板说：“蒜要泡够21天才够脆	\N	\N	f	ai	t	2026-08-09 14:02:03.578	2026-08-09 14:02:03.578
cmslvg2wq006bi5cxgjeh8fh8	餐饮	topic	\N	\N	春节返乡潮｜高铁站候车厅里的家乡味窗口：妈妈教的臊子面配方被写在玻璃上	\N	\N	f	ai	t	2026-08-09 14:02:03.579	2026-08-09 14:02:03.579
cmslvg2wr006ci5cxn7ulndyz	餐饮	topic	\N	\N	元宵灯会夜｜糖芋苗摊主手写菜单曝光：甜度可选“初恋级”“失恋级”“佛系级	\N	\N	f	ai	t	2026-08-09 14:02:03.579	2026-08-09 14:02:03.579
cmslvg2ws006di5cxgwbgau1z	餐饮	topic	\N	\N	情人节后遗症｜单身食谱上线：一人份鲍鱼捞饭+解压捏捏乐套餐真香现场	\N	\N	f	ai	t	2026-08-09 14:02:03.581	2026-08-09 14:02:03.581
cmslvg2wt006ei5cx1cy5njkh	餐饮	topic	\N	\N	惊蛰醒春｜头茬韭菜盒子刚出锅就抢空，摊主：韭菜是自家阳台种的	\N	\N	f	ai	t	2026-08-09 14:02:03.581	2026-08-09 14:02:03.581
cmslvg2wt006fi5cxld28bmer	餐饮	topic	\N	\N	春分尝鲜｜河鲜馆现杀昂刺鱼直播：鱼肚白膜刮净才敢下锅，汤色奶白无腥	\N	\N	f	ai	t	2026-08-09 14:02:03.582	2026-08-09 14:02:03.582
cmslvg2wu006gi5cxkoc0ppm1	餐饮	topic	\N	\N	清明后茶季｜龙井虾仁用明前茶梗炒？后厨偷拍师傅“抖茶”三秒出香全过程	\N	\N	f	ai	t	2026-08-09 14:02:03.582	2026-08-09 14:02:03.582
cmslvg2wv006hi5cxrupnfqw8	餐饮	topic	\N	\N	五一调休日｜打工人午休1小时极限挑战：3家步行5分钟内搞定热汤+主食+甜品	\N	\N	f	ai	t	2026-08-09 14:02:03.583	2026-08-09 14:02:03.583
cmslvg2wv006ii5cxbsaxrlc9	餐饮	topic	\N	\N	端午龙舟赛｜江边烧烤摊同步直播赛事，下单“加油套餐”送荧光手环+鼓槌	\N	\N	f	ai	t	2026-08-09 14:02:03.584	2026-08-09 14:02:03.584
cmslvg2ww006ji5cxqv5m26vi	餐饮	topic	\N	\N	七夕错峰局｜工作日晚8点后双人餐5折，服务员悄悄塞你一张手写情话小票	\N	\N	f	ai	t	2026-08-09 14:02:03.584	2026-08-09 14:02:03.584
cmslvg2ww006ki5cxt5c8nza9	餐饮	topic	\N	\N	中秋团圆饭｜家庭聚餐避雷清单：这6家号称“包间私密”的店，隔壁咳嗽都听见	\N	\N	f	ai	t	2026-08-09 14:02:03.585	2026-08-09 14:02:03.585
cmslvg2wx006li5cxdaw3fid9	餐饮	topic	\N	\N	冬至暖灶｜羊肉炉店送围巾活动背后：每条围巾都是店主奶奶织的，已送出217条	\N	\N	f	ai	t	2026-08-09 14:02:03.585	2026-08-09 14:02:03.585
cmslvg2wx006mi5cx6ec3basn	餐饮	topic	\N	\N	腊月扫尘｜年夜饭预制菜盲测：3家本地酒楼出品对比，冷链包装里藏着哪道硬菜	\N	\N	f	ai	t	2026-08-09 14:02:03.586	2026-08-09 14:02:03.586
cmslvgdp9006ni5cxek8culwj	餐饮	image_prompt	\N	\N	\N	一张高清实拍的招牌红烧肉特写，琥珀色酱汁淋在肥瘦相间的五花肉上，表面微焦泛油光，旁边搭一筷青翠蒜苗，浅景深木质砧板背景，ins风柔和自然光	\N	f	ai	t	2026-08-09 14:02:17.566	2026-08-09 14:02:17.566
cmslvgdpc006oi5cxavf7nvqw	餐饮	image_prompt	\N	\N	\N	一张真实厨房出餐场景：厨师戴白帽系围裙，正将刚起锅的沸腾麻辣香锅盛入青花瓷大碗，热气升腾，辣椒花椒清晰可见，写实风格纪实摄影质感	\N	f	ai	t	2026-08-09 14:02:17.569	2026-08-09 14:02:17.569
cmslvgdpe006pi5cx0o2f01kd	餐饮	image_prompt	\N	\N	\N	一张国潮风菜品海报：水墨晕染的“老灶头”印章盖在烫金菜单边角，中央是油亮椒麻鸡摆盘，配竹简式菜名书法字“川魂椒麻鸡”，朱砂红+靛青主色	\N	f	ai	t	2026-08-09 14:02:17.57	2026-08-09 14:02:17.57
cmslvgdpf006qi5cx2bau2kam	餐饮	image_prompt	\N	\N	\N	一张ins风门店外立面：暖黄灯笼斜照青砖墙，“巷子口小馆”手写体招牌微微褪色，门口藤编灯罩垂落，绿植爬墙，午后柔光滤镜	\N	f	ai	t	2026-08-09 14:02:17.571	2026-08-09 14:02:17.571
cmslvgdpg006ri5cxvz8mfghz	餐饮	image_prompt	\N	\N	\N	一张写实风格堂食环境：午市高峰期，四人圆桌坐满本地家庭，老人夹菜、孩子喝酸梅汤、年轻人举杯，玻璃窗映出梧桐树影，中景平视构图	\N	f	ai	t	2026-08-09 14:02:17.573	2026-08-09 14:02:17.573
cmslvgdph006si5cx1zjve74n	餐饮	image_prompt	\N	\N	\N	一张国潮风门头设计：飞檐翘角剪影为框，内嵌“烟火南塘”篆书灯箱，两侧对联“一勺熬尽三载味，半碟盛来四时鲜”，朱砂红灯笼+青灰砖纹底	\N	f	ai	t	2026-08-09 14:02:17.574	2026-08-09 14:02:17.574
cmslvgdpi006ti5cxkbj7ip27	餐饮	image_prompt	\N	\N	\N	一张ins风团购活动海报：奶油白底，手绘风火锅emoji环绕“99元双人涮肉套餐”，底部撕纸效果露出“限量50份”烫金字，马卡龙色系点缀	\N	f	ai	t	2026-08-09 14:02:17.575	2026-08-09 14:02:17.575
cmslvgdpk006ui5cxb8snxegv	餐饮	image_prompt	\N	\N	\N	一张写实风格节日促销横幅：实体店门口悬挂红布横幅，“中秋家宴预定享8折”毛笔字略带墨痕，背景是真实挂满灯笼的店招与排队顾客侧影	\N	f	ai	t	2026-08-09 14:02:17.577	2026-08-09 14:02:17.577
cmslvgdpl006vi5cx3drwxqn1	餐饮	image_prompt	\N	\N	\N	一张国潮风储值卡宣传图：宣纸纹理底，祥云纹边框内嵌金色储值卡视觉，“充300送50”用活字印刷字体排版，右下角盖“福”字朱印	\N	f	ai	t	2026-08-09 14:02:17.578	2026-08-09 14:02:17.578
cmslvgdpn006wi5cxxepzjh69	餐饮	image_prompt	\N	\N	\N	一张ins风顾客打卡照：女生穿浅蓝衬衫举手机自拍，背景虚化出“爆汁生煎”铁锅与蒸汽，桌上散落蘸料碟和小葱，自然光+胶片颗粒感	\N	f	ai	t	2026-08-09 14:02:17.579	2026-08-09 14:02:17.579
cmslvgdpo006xi5cx9lir62rx	餐饮	image_prompt	\N	\N	\N	一张写实风格家庭聚餐实录：爷爷给孙子夹虾，桌上八宝饭冒热气，玻璃转盘反射吊灯，镜头略俯视角，无摆拍痕迹，生活流纪实感	\N	f	ai	t	2026-08-09 14:02:17.58	2026-08-09 14:02:17.58
cmslvgdpp006yi5cxn11vur5c	餐饮	image_prompt	\N	\N	\N	一张国潮风朋友圈晒单图：手机界面截图风设计，微信对话框弹出“这波团购太值了！”，对话气泡里嵌菜品九宫格，边框用窗棂纹+铜钱纹	\N	f	ai	t	2026-08-09 14:02:17.581	2026-08-09 14:02:17.581
cmslvgdpq006zi5cxf9dynz2q	餐饮	image_prompt	\N	\N	\N	一张ins风深夜食堂氛围：22:30街角小店，暖光从玻璃窗溢出，长吧台坐两三个剪影，一碗热腾腾阳春面雾气朦胧，蓝紫夜色+鹅黄窗光对比	\N	f	ai	t	2026-08-09 14:02:17.582	2026-08-09 14:02:17.582
cmslvgdpq0070i5cxx5jxk7i3	餐饮	image_prompt	\N	\N	\N	一张写实风格雨天聚餐场景：窗外雨丝斜织，店内玻璃蒙着薄雾，情侣共撑一把伞进门，服务员递上姜茶，地面水渍反光，电影级光影叙事	\N	f	ai	t	2026-08-09 14:02:17.583	2026-08-09 14:02:17.583
cmslvgdpr0071i5cx0u6hea99	餐饮	image_prompt	\N	\N	\N	一张国潮风节气宴氛围图：冬至主题，青瓷碗盛汤圆浮于檀木托盘，背景水墨梅花枝斜出，题字“冬至一阳生”，赭石+月白+墨黑传统配色	\N	f	ai	t	2026-08-09 14:02:17.584	2026-08-09 14:02:17.584
cmslvgy9l0072i5cxxvl44ohk	教育	title	数字	数字	3个被90%家长忽略的提分细节，孩子多考20分真不难	\N	\N	f	ai	t	2026-08-09 14:02:44.216	2026-08-09 14:02:44.216
cmslvgy9m0073i5cxl1i07hfg	教育	title	反差	反差	小学语文成绩垫底→期末冲进年级前10：她只改了这1个习惯	\N	\N	f	ai	t	2026-08-09 14:02:44.219	2026-08-09 14:02:44.219
cmslvgy9n0074i5cxwily558f	教育	title	疑问	疑问	孩子刷题2小时不如别人20分钟？真相让老师都沉默了	\N	\N	f	ai	t	2026-08-09 14:02:44.219	2026-08-09 14:02:44.219
cmslvgy9n0075i5cxryjvq7ls	教育	title	痛点	痛点	每天陪学3小时，成绩却倒退”——你家也在无效努力吗？	\N	\N	f	ai	t	2026-08-09 14:02:44.22	2026-08-09 14:02:44.22
cmslvgy9o0076i5cxz5boeekb	教育	title	福利	福利	免费领《K12高效学习自查表》，92%家长测出3个隐藏漏洞	\N	\N	f	ai	t	2026-08-09 14:02:44.221	2026-08-09 14:02:44.221
cmslvgy9p0077i5cxf2l8jo9a	教育	title	权威数据	权威数据	教育部最新调研：坚持错题本的学生，中考数学平均高14.6分	\N	\N	f	ai	t	2026-08-09 14:02:44.221	2026-08-09 14:02:44.221
cmslvgy9p0078i5cx29jq2voc	教育	title	悬念	悬念	孩子突然厌学、抗拒打卡…背后藏着一个被忽视的神经信号	\N	\N	f	ai	t	2026-08-09 14:02:44.222	2026-08-09 14:02:44.222
cmslvgy9q0079i5cxlobfe808	教育	title	共情	共情	上次家长会老师说他懒，其实他每天熬夜到1点”｜一位妈妈的深夜来信	\N	\N	f	ai	t	2026-08-09 14:02:44.222	2026-08-09 14:02:44.222
cmslvgy9q007ai5cxd16gsvbb	教育	title	故事	故事	从连续3次月考不及格，到高考英语逆袭132分：她的笔记曝光了	\N	\N	f	ai	t	2026-08-09 14:02:44.223	2026-08-09 14:02:44.223
cmslvgy9r007bi5cxk38av6qf	教育	title	清单	清单	小学数学必须掌握的7个思维锚点（附免费诊断工具）	\N	\N	f	ai	t	2026-08-09 14:02:44.223	2026-08-09 14:02:44.223
cmslvgy9r007ci5cx26zodsp3	教育	title	热点	热点	双减三周年，为什么重点校课后服务报名率反涨47%？	\N	\N	f	ai	t	2026-08-09 14:02:44.224	2026-08-09 14:02:44.224
cmslvgy9s007di5cxnwl1lka0	教育	title	对比	对比	公立校老师私下用的作文模板 vs 普通机构教法，差距在哪？	\N	\N	f	ai	t	2026-08-09 14:02:44.224	2026-08-09 14:02:44.224
cmslvgy9s007ei5cx3hcbdzqs	教育	title	对比	对比	5年跟踪2863名学员：坚持晨读的孩子，英语听力正确率高出31%	\N	\N	f	ai	t	2026-08-09 14:02:44.225	2026-08-09 14:02:44.225
cmslvgy9t007fi5cxtl0diz93	教育	title	对比	对比	初中物理从48分到92分，她没报班，只靠每天12分钟“三色笔法	\N	\N	f	ai	t	2026-08-09 14:02:44.225	2026-08-09 14:02:44.225
cmslvgy9t007gi5cxecq2wqlt	教育	title	对比	对比	报了3个班，孩子更累了”——你的教育投入正在陷入‘勤奋陷阱’？	\N	\N	f	ai	t	2026-08-09 14:02:44.226	2026-08-09 14:02:44.226
cmslvgy9u007hi5cx2kaek2in	教育	title	对比	对比	孩子一写作业就走神？不是专注力差，是大脑在发出求救信号	\N	\N	f	ai	t	2026-08-09 14:02:44.226	2026-08-09 14:02:44.226
cmslvgy9u007ii5cxdrbjuak2	教育	title	对比	对比	限时开放｜前50名预约试听，赠价值299元《学科能力图谱》+学情报告	\N	\N	f	ai	t	2026-08-09 14:02:44.227	2026-08-09 14:02:44.227
cmslvgy9v007ji5cxrutw2vpl	教育	title	对比	对比	北师大研究证实：家长用“描述性鼓励”代替“你真棒”，孩子坚持率提升2.3倍	\N	\N	f	ai	t	2026-08-09 14:02:44.227	2026-08-09 14:02:44.227
cmslvgy9v007ki5cx6f2wx4ph	教育	title	对比	对比	刚上初二就放弃数学？别急着补课，先看这3个知识断层预警信号	\N	\N	f	ai	t	2026-08-09 14:02:44.228	2026-08-09 14:02:44.228
cmslvgy9w007li5cxbhrz1pl3	教育	title	对比	对比	妈妈，我不想再考第一了”｜那个总考满分的女孩，在咨询室哭了半小时	\N	\N	f	ai	t	2026-08-09 14:02:44.228	2026-08-09 14:02:44.228
cmslvgy9w007mi5cxq52bfs0j	教育	title	对比	对比	9岁男孩用“故事链记忆法”，7天背完小古文16篇｜真实学习日志公开	\N	\N	f	ai	t	2026-08-09 14:02:44.229	2026-08-09 14:02:44.229
cmslvgy9x007ni5cxhn4lpqun	教育	title	对比	对比	中考生必存！中考英语高频58词根+216个派生词（可打印版）	\N	\N	f	ai	t	2026-08-09 14:02:44.23	2026-08-09 14:02:44.23
cmslvgy9y007oi5cxb24t5xy3	教育	title	对比	对比	ChatGPT冲击下，为什么顶尖高中把“提问力”列为新刚需？	\N	\N	f	ai	t	2026-08-09 14:02:44.23	2026-08-09 14:02:44.23
cmslvgy9y007pi5cx8poxcwpw	教育	title	对比	对比	线上课vs线下课效果差多少？真实数据对比：续费率、提分率、完课率全解析	\N	\N	f	ai	t	2026-08-09 14:02:44.231	2026-08-09 14:02:44.231
cmslvgy9z007qi5cxj44onr23	教育	title	对比	对比	7个让老师眼前一亮的作文开头，阅卷老师平均多给2.5分	\N	\N	f	ai	t	2026-08-09 14:02:44.231	2026-08-09 14:02:44.231
cmslvgy9z007ri5cx595shxmj	教育	title	对比	对比	孩子数学总在80分卡住？不是粗心，是缺这1种底层建模能力	\N	\N	f	ai	t	2026-08-09 14:02:44.232	2026-08-09 14:02:44.232
cmslvgya0007si5cxvfz8f4ps	教育	title	对比	对比	为什么我家孩子记不住？”——神经教育学给出的答案太扎心	\N	\N	f	ai	t	2026-08-09 14:02:44.232	2026-08-09 14:02:44.232
cmslvgya0007ti5cx61jsprjj	教育	title	对比	对比	孩子说“听懂了但不会做”，其实是大脑里少了这座“解题脚手架	\N	\N	f	ai	t	2026-08-09 14:02:44.233	2026-08-09 14:02:44.233
cmslvgya1007ui5cxhwv41851	教育	title	对比	对比	0元解锁｜清北教研组打磨的《小学奥数启蒙地图》，扫码即领	\N	\N	f	ai	t	2026-08-09 14:02:44.233	2026-08-09 14:02:44.233
cmslvgya1007vi5cx2tucux44	教育	title	对比	对比	中国教科院报告：家庭每日有效对话超12分钟，孩子逻辑表达力提升40%	\N	\N	f	ai	t	2026-08-09 14:02:44.234	2026-08-09 14:02:44.234
cmslvgya2007wi5cx584q7iao	教育	title	对比	对比	辅导作业吼到失声？试试“3句话暂停法”，90%家长第2天就见效	\N	\N	f	ai	t	2026-08-09 14:02:44.234	2026-08-09 14:02:44.234
cmslvgya2007xi5cxo01ik2wj	教育	title	对比	对比	他小学一直前三，初中直接掉出班级前20”｜一场家长会后的复盘日记	\N	\N	f	ai	t	2026-08-09 14:02:44.235	2026-08-09 14:02:44.235
cmslvgya3007yi5cx42oeyxv8	教育	title	对比	对比	初中化学入门必会的6类实验现象口诀（附动态演示视频）	\N	\N	f	ai	t	2026-08-09 14:02:44.235	2026-08-09 14:02:44.235
cmslvgya3007zi5cxiig5u1wv	教育	title	对比	对比	教育博主不敢说的真相：今年教师编笔试通过率暴跌至21.4%	\N	\N	f	ai	t	2026-08-09 14:02:44.236	2026-08-09 14:02:44.236
cmslvgya40080i5cx52vglz84	教育	title	对比	对比	海淀妈妈群疯传的“周末2小时学习流”，已帮137个孩子稳居年级前5%	\N	\N	f	ai	t	2026-08-09 14:02:44.236	2026-08-09 14:02:44.236
cmslvgya40081i5cxmpzj7zsl	教育	title	对比	对比	12个信号说明孩子正悄悄掉队：第8条90%家长都忽略了	\N	\N	f	ai	t	2026-08-09 14:02:44.237	2026-08-09 14:02:44.237
cmslvgya50082i5cxzwdwy05q	教育	title	对比	对比	孩子背单词像嚼蜡？脑科学证实：图像联结法记忆效率高3.8倍	\N	\N	f	ai	t	2026-08-09 14:02:44.237	2026-08-09 14:02:44.237
cmslvgya50083i5cxtls099no	教育	title	对比	对比	我是不是不适合学数学？”——当孩子开始自我否定，请先看这份评估清单	\N	\N	f	ai	t	2026-08-09 14:02:44.238	2026-08-09 14:02:44.238
cmslvgya70084i5cxmgcoeif6	教育	title	对比	对比	孩子写作业拖拉到凌晨？不是懒，是执行功能发育滞后2.1年	\N	\N	f	ai	t	2026-08-09 14:02:44.239	2026-08-09 14:02:44.239
cmslvgya80085i5cxfytptqrn	教育	title	对比	对比	赠｜《家庭教育能量自查手册》含12项指标+改善路径（限今日）	\N	\N	f	ai	t	2026-08-09 14:02:44.24	2026-08-09 14:02:44.24
cmslvgya80086i5cx2yadue0w	教育	title	对比	对比	华东师大追踪研究：使用结构化笔记的学生，期中复习效率提升55%	\N	\N	f	ai	t	2026-08-09 14:02:44.241	2026-08-09 14:02:44.241
cmslvgya90087i5cx6urfl6xl	教育	title	对比	对比	孩子一考试就肚子疼、手抖？这不是紧张，是焦虑躯体化的早期表现	\N	\N	f	ai	t	2026-08-09 14:02:44.241	2026-08-09 14:02:44.241
cmslvgya90088i5cxwxuneup8	教育	title	对比	对比	以前天天盯着，现在他主动订正错题”｜初二男生妈妈的30天改变实录	\N	\N	f	ai	t	2026-08-09 14:02:44.242	2026-08-09 14:02:44.242
cmslvgyaa0089i5cxgz2i4cjx	教育	title	对比	对比	K12家长收藏！语数英三科「易错题归因速查表」（覆盖7-9年级）	\N	\N	f	ai	t	2026-08-09 14:02:44.242	2026-08-09 14:02:44.242
cmslvgyaa008ai5cx0r9zv4v1	教育	title	对比	对比	双减后我们停掉2个班，孩子反而进了重点班”｜深圳家长亲述决策逻辑	\N	\N	f	ai	t	2026-08-09 14:02:44.243	2026-08-09 14:02:44.243
cmslvgyaa008bi5cxqpsrezyb	教育	title	对比	对比	新课标落地首年，为什么小学科学实践题得分率不足53%？	\N	\N	f	ai	t	2026-08-09 14:02:44.243	2026-08-09 14:02:44.243
cmslvgyab008ci5cx2umpmwlt	教育	title	对比	对比	4步拆解“别人家孩子”的时间管理术，实测适合普通家庭	\N	\N	f	ai	t	2026-08-09 14:02:44.243	2026-08-09 14:02:44.243
cmslvgyab008di5cx5k5jalcf	教育	title	对比	对比	孩子作文总被批“假大空”？缺的不是素材，是这1个观察视角训练	\N	\N	f	ai	t	2026-08-09 14:02:44.244	2026-08-09 14:02:44.244
cmslvgyac008ei5cx6v29kk9u	教育	title	对比	对比	为什么越讲孩子越不会？”——特级教师揭秘教学中的3个认知断点	\N	\N	f	ai	t	2026-08-09 14:02:44.244	2026-08-09 14:02:44.244
cmslvgyad008fi5cxy2lram29	教育	title	对比	对比	孩子拒绝沟通、锁门、敷衍回答…警惕青春期前的“心理静音期	\N	\N	f	ai	t	2026-08-09 14:02:44.245	2026-08-09 14:02:44.245
cmslvgyad008gi5cx64kekt9n	教育	title	对比	对比	0门槛领取｜《中高考政策变动应对指南》含3省最新指标到校解读	\N	\N	f	ai	t	2026-08-09 14:02:44.245	2026-08-09 14:02:44.245
cmslvgyad008hi5cxxv1mkxzk	教育	title	对比	对比	权威期刊《Learning and Instruction》：间隔重复比集中刷题提分快2.7倍	\N	\N	f	ai	t	2026-08-09 14:02:44.246	2026-08-09 14:02:44.246
cmslvgyae008ii5cxdos42109	教育	title	对比	对比	孩子一学奥数就哭？不是天赋问题，是没跨过这道“思维坡度	\N	\N	f	ai	t	2026-08-09 14:02:44.246	2026-08-09 14:02:44.246
cmslvgyae008ji5cxsjleast7	教育	title	对比	对比	爸爸陪练1个月，孩子	\N	\N	f	ai	t	2026-08-09 14:02:44.247	2026-08-09 14:02:44.247
cmslvhytp008ki5cx9rrxw5a6	教育	article	新客引流	\N	\N	新客引流：孩子英语学了三年还在背单词？不是不努力，是方法错了。我们用「场景化思维导图+母语式输出训练」，帮327名小学员半年内实现从不敢开口到主动讲英文故事。现在预约0元诊断课，教育规划师1对1分析学习卡点，附赠《K12英语能力自测表》（含CEFR对标说明）。名额限前50名，扫码立即锁定。	\N	f	ai	t	2026-08-09 14:03:31.596	2026-08-09 14:03:31.596
cmslvhyts008li5cx35ztwiyd	教育	article	老客复购	\N	\N	新客引流：考证总差3-5分？不是基础弱，是备考路径没闭环。近89%的教资/会计/人力考生栽在「知识→题感→应试节奏」断层上。我们独创「三阶靶向训练法」，2024上半年1362名学员一次过线率提升至78.6%。免费领取《高频失分题型拆解手册》，含近3年真题陷阱标注+避坑口诀。	\N	f	ai	t	2026-08-09 14:03:31.601	2026-08-09 14:03:31.601
cmslvhytu008mi5cx26a9mpu9	教育	article	产品种草	\N	\N	新客引流：家长常问：“试听课能看出来老师好不好吗？”答案是：能——但要看3个关键动作。我们公开教学质检标准：①课堂前3分钟是否激活旧知 ②每15分钟是否有即时反馈 ③下课前是否生成个性化作业单。点击预约体验课，同步获取《教师资质核验指南》（含12项硬指标自查表）。	\N	f	ai	t	2026-08-09 14:03:31.602	2026-08-09 14:03:31.602
cmslvhytv008ni5cx3qf6728v	教育	article	客户见证	\N	\N	老客复购：去年跟班学完小升初数学的李同学，这次主动续报「初中逻辑力进阶营」——不是因为课程好，而是他发现：原来几何证明题可以像搭乐高一样拆解。237位续报家长反馈：孩子开始主动整理错因、预判命题逻辑。老学员享优先排课+专属学情复盘会，续费即赠《学科能力跃迁地图》。	\N	f	ai	t	2026-08-09 14:03:31.603	2026-08-09 14:03:31.603
cmslvhytw008oi5cxzci04ite	教育	article	节假日活动	\N	\N	老客复购：教资笔试通过后，73%的人卡在面试“说不出亮点”。去年218位拿证学员中，有156人选择续报我们的「结构化+试讲双轨特训」，平均模拟评分从68.2分提升至84.7分。老学员复购享「不过退费升级版」：未通过全额退，再报赠1v1教案精修3次。	\N	f	ai	t	2026-08-09 14:03:31.604	2026-08-09 14:03:31.604
cmslvhytx008pi5cx4e9icixy	教育	article	品牌故事	\N	\N	老客复购：钢琴考级通过≠会音乐表达。去年续报「音乐素养深化课」的学员中，91%在演奏时加入自主处理，老师反馈“听得出思考痕迹”。老用户专享：续报即解锁往期全部大师课回放+定制化曲目推荐引擎（输入孩子当前水平自动匹配3首进阶曲）。	\N	f	ai	t	2026-08-09 14:03:31.606	2026-08-09 14:03:31.606
cmslvhytz008qi5cxyi6r28fe	教育	article	上新公告	\N	\N	产品种草：别再让孩子“刷完题就扔”！我们的「错题再生系统」把每次订正变成能力生长点：AI自动归因（概念模糊/审题失误/计算跳步）→推送同类变式题→生成薄弱点热力图→关联校内单元目标。已服务4.2万学员，平均错题重犯率下降63%。	\N	f	ai	t	2026-08-09 14:03:31.608	2026-08-09 14:03:31.608
cmslvhyu1008ri5cxaul88ith	教育	article	优惠活动	\N	\N	产品种草：为什么90%的作文提分慢？缺的不是好词好句，而是「思维脚手架」。我们的「五维立意法」带孩子从“写完就行”走向“写得有立场”：事件层→情感层→选择层→价值层→时代层。使用学员作文平均分提升5.8分，37篇入选省级优秀习作集。	\N	f	ai	t	2026-08-09 14:03:31.61	2026-08-09 14:03:31.61
cmslvhyu3008si5cxdcc9f1m7	教育	article	知识科普	\N	\N	产品种草：编程不是敲代码，是培养“把大问题切成小步骤”的生存能力。Scratch阶段重点练拆解与调试，Python阶段强化逻辑建模，C++阶段训练系统思维。课程通过中国电子学会等级考试官方合作考点认证，学员参赛获奖率超行业均值2.3倍。	\N	f	ai	t	2026-08-09 14:03:31.611	2026-08-09 14:03:31.611
cmslvhyu4008ti5cxjjq1e3jq	教育	article	互动话题	\N	\N	客户见证：“孩子说‘妈妈，这道题我教你怎么讲’——那一刻我知道值了。”杭州陈妈妈，孩子五年级数学从72分到稳定95+，关键转折是学完我们的「讲题反哺法」：每天1道题当小老师录讲解视频，倒逼逻辑显性化。完整学习报告已授权查看。	\N	f	ai	t	2026-08-09 14:03:31.612	2026-08-09 14:03:31.612
cmslvhyu5008ui5cx1tolajzl	教育	article	答疑辟谣	\N	\N	客户见证：35岁转行做UI设计的张姐，零基础+全职妈妈，用我们「项目驱动式学习路径」，6个月完成3个商业级作品集，拿下深圳某科技公司UX岗offer。她说：“不是时间多，是每分钟都踩在能力增长点上。”真实offer截图+作品集链接可查。	\N	f	ai	t	2026-08-09 14:03:31.613	2026-08-09 14:03:31.613
cmslvhyu6008vi5cxb03jejz5	教育	article	会员权益	\N	\N	客户见证：广州初二学生林同学，英语月考常年70分左右，跟学「阅读策略工具箱」后，期末考92分，卷面出现5处自主批注（老师特意圈出表扬）。家长晒出对比笔记：左侧是过去抄写式摘抄，右侧是用「信息锚点法」做的逻辑链笔记。	\N	f	ai	t	2026-08-09 14:03:31.614	2026-08-09 14:03:31.614
cmslvhyu7008wi5cxtac7cm8e	教育	article	会员权益	\N	\N	节假日活动：中秋不只赏月，更要“看见进步”。即日起至9月17日，所有新生预约试听即赠《学科成长月历》（含24节气学习锦囊+亲子共学打卡页）；老学员推荐1位新朋友，双方各得1节「能力诊断微课」+定制化学习建议书。	\N	f	ai	t	2026-08-09 14:03:31.615	2026-08-09 14:03:31.615
cmslvhyu8008xi5cx7ks68uz2	教育	article	会员权益	\N	\N	节假日活动：教师节致敬真教育者——我们把课堂交给您检验。9月10日当天，开放全部主讲教师10分钟公开课切片（含教案设计思路语音解读），扫码即可查看「这节课为什么这样设计」的底层逻辑。参与投票选“最想跟学的老师”，抽10人免单报名。	\N	f	ai	t	2026-08-09 14:03:31.616	2026-08-09 14:03:31.616
cmslvhyu9008yi5cxy3soqcae	教育	article	会员权益	\N	\N	节假日活动：国庆长假=弯道超车黄金72小时。我们推出「学科突破冲刺包」：3天直播+7天督学+1份能力雷达图报告。小学数学聚焦“应用题建模”，初中物理攻克“电路动态分析”，教资面试直击“突发状况应对”。前200名下单赠《假期学习能量包》（含番茄钟贴纸+错题便利贴）。	\N	f	ai	t	2026-08-09 14:03:31.617	2026-08-09 14:03:31.617
cmslvhyua008zi5cxjynhiiub	教育	article	会员权益	\N	\N	品牌故事：2016年，3位一线教研员发现：孩子错题本越厚，进步越慢。他们辞职扎进17所中小学蹲点调研，最终验证一个事实——87%的知识漏洞藏在“我以为我会”的缝隙里。于是有了今天的「精准干预模型」，不追进度，只守能力阈值。	\N	f	ai	t	2026-08-09 14:03:31.618	2026-08-09 14:03:31.618
cmslvhyub0090i5cx1oni7sg6	教育	article	会员权益	\N	\N	品牌故事：创始人王老师带毕业班14年，最痛心不是学生考砸，而是他们说“我试过了，就是不行”。2020年她带着整套高三二轮教案离开公办体系，创办机构初心很朴素：“让每个‘试过’都有回响——不是安慰，是给出第三条路、第四种解法。	\N	f	ai	t	2026-08-09 14:03:31.619	2026-08-09 14:03:31.619
cmslvhyuc0091i5cxapq7rp17	教育	article	会员权益	\N	\N	品牌故事：我们不用“清北名师”做标签，因为真正的好老师，是那个记得住你孩子上次提问眼神的人。每位主讲教师需通过「三阶认证」：学科功底测试（难度超高考20%）+课堂行为编码分析（录像逐帧打分）+家长匿名满意度≥92%。	\N	f	ai	t	2026-08-09 14:03:31.621	2026-08-09 14:03:31.621
cmslvhyud0092i5cxoqjeqpvd	教育	article	会员权益	\N	\N	上新公告：重磅上线「初中物理跨学科实践课」！融合航天工程（牛顿定律）、环保议题（能量转化）、医疗科技（超声成像），每节课解决1个真实世界问题。配套自主研发教具套盒（含可编程传感器+AR实验沙盘），首批开放500套，预订享早鸟价+优先匹配实验导师。	\N	f	ai	t	2026-08-09 14:03:31.622	2026-08-09 14:03:31.622
cmslvhyue0093i5cx76pv5d2x	教育	article	会员权益	\N	\N	上新公告：针对“背了忘、忘了背”痛点，全新推出《文言文思维地图》系列课。不逐字翻译，用“人物关系网+事件动力轴+观点演进树”三维重构经典篇目。已上线《岳阳楼记》《出师表》《桃花源记》，学员课堂复述准确率提升至91%，文言实词迁移运用率达76%。	\N	f	ai	t	2026-08-09 14:03:31.623	2026-08-09 14:03:31.623
cmslvhyuf0094i5cxwhilw7ua	教育	article	会员权益	\N	\N	上新公告：成人职场写作课正式开课！拒绝模板堆砌，聚焦“让领导秒懂、让同事愿执行、让客户愿买单”三大场景。模块包括：周报如何暴露你的思考深度、方案PPT怎样讲出不可替代性、跨部门邮件怎么降低沟通损耗。首发价限时5折，含1v1文书诊断。	\N	f	ai	t	2026-08-09 14:03:31.623	2026-08-09 14:03:31.623
cmslvhyug0095i5cxzttmra2y	教育	article	会员权益	\N	\N	优惠活动：暑期收尾战报：673位学员完成「21天习惯养成计划」，92%达成目标（如每日自主整理错题、每周输出1篇思辨短评）。即日起至8月31日，报名任意正价课，加赠《习惯养成工具包》（含打卡日历+行为契约书+家庭激励指南），再减200元。	\N	f	ai	t	2026-08-09 14:03:31.624	2026-08-09 14:03:31.624
cmslvhyug0096i5cxmoqthzgw	教育	article	会员权益	\N	\N	优惠活动：老带新升级为「成长合伙人计划」：推荐成功1人，您得300元课程金+对方获赠《学习力启动课》；推荐满3人，额外解锁「年度学情管家服务」（每月1次学习策略调优+升学政策解读）。所有奖励实时到账，无门槛可抵扣。	\N	f	ai	t	2026-08-09 14:03:31.625	2026-08-09 14:03:31.625
cmslvhyuh0097i5cx0u15eg4g	教育	article	会员权益	\N	\N	优惠活动：不是低价，是让效果更可见。即日起报名全年课程，享「双保险机制」：①30天无理由退费（按实际课时结算）②学满60课时未达承诺目标，补足差额课时或退剩余学费。合同白纸黑字，扫码查看完整条款。	\N	f	ai	t	2026-08-09 14:03:31.626	2026-08-09 14:03:31.626
cmslvhyui0098i5cxspm6gu9i	教育	article	会员权益	\N	\N	知识科普：很多家长不知道：小学奥数杯赛停办≠思维训练不重要。真正该淘汰的是“套路刷题”，该保留的是“定义问题→寻找约束→验证路径”的元能力。我们用生活化课题（如规划家庭旅行预算、设计班级图书角动线）培养这种能力，测评显示学员解决开放性问题效率提升41%。	\N	f	ai	t	2026-08-09 14:03:31.627	2026-08-09 14:03:31.627
cmslvhyuj0099i5cxf7c6zvr3	教育	article	会员权益	\N	\N	知识科普：“孩子粗心”可能是认知负荷超载。当一道题需要同时调用3个以上知识点+2种运算顺序+单位换算，大脑会本能跳过细节。我们的「分阶承载训练」先拆解单一认知负荷，再叠加组合，使专注力持续时长从8分钟延长至22分钟（脑电波监测数据）。	\N	f	ai	t	2026-08-09 14:03:31.628	2026-08-09 14:03:31.628
cmslvhyuk009ai5cxzqpvs257	教育	article	会员权益	\N	\N	知识科普：为什么孩子一做阅读理解就“找不到答案”？不是没读懂，是没建立“文本功能意识”——知道哪段讲观点、哪段举例子、哪段埋伏笔。我们用彩色标记法+功能卡片游戏，帮助孩子3节课建立文本解码本能，正确率提升显著（前测均分52→后测79）。	\N	f	ai	t	2026-08-09 14:03:31.628	2026-08-09 14:03:31.628
cmslvhyul009bi5cxx6ypdi1s	教育	article	会员权益	\N	\N	互动话题：你家孩子最近一次“突然开窍”，是因为哪件事？是某次失败后的复盘？某本书的触动？还是和你的一次对话？评论区分享，我们将精选10个故事，邀请教育心理学专家逐条解析“开窍背后的神经机制”，并赠送《家庭启发时刻记录册》。	\N	f	ai	t	2026-08-09 14:03:31.629	2026-08-09 14:03:31.629
cmslvhyum009ci5cx0y6ix4l5	教育	article	会员权益	\N	\N	互动话题：如果给孩子一个“学习特权日”，他会怎么安排？是睡到自然醒？是自己选学什么？还是带老师来家里上课？投票选出TOP3创意，我们将联合教研组落地1个真实版本——让孩子的教育想象，成为我们的课程设计起点。	\N	f	ai	t	2026-08-09 14:03:31.63	2026-08-09 14:03:31.63
cmslvhyun009di5cx2z3vqed3	教育	article	会员权益	\N	\N	互动话题：你最想删掉孩子学习中的哪个词？是“赶紧写完”？“别人都会”？还是“下次注意”？留言说出那个词+背后的故事，我们将制作《教育语言净化指南》，帮你把焦虑句式转化为	\N	f	ai	t	2026-08-09 14:03:31.631	2026-08-09 14:03:31.631
cmslvic50009ei5cxekxttavs	教育	topic	\N	\N	寒假预习黄金期：小学数学计算总出错？3个底层思维训练法，90%孩子1周见效	\N	\N	f	ai	t	2026-08-09 14:03:48.852	2026-08-09 14:03:48.852
cmslvic52009fi5cx33tbtf5s	教育	topic	\N	\N	春节后收心难？用「5分钟启动仪式」帮孩子自然回归学习状态（附模板）	\N	\N	f	ai	t	2026-08-09 14:03:48.855	2026-08-09 14:03:48.855
cmslvic54009gi5cxnk9c55z4	教育	topic	\N	\N	教育部新课标落地首年：初中英语阅读题型突变，家长最该盯住的3个能力缺口	\N	\N	f	ai	t	2026-08-09 14:03:48.856	2026-08-09 14:03:48.856
cmslvic55009hi5cxqxkzu4p6	教育	topic	\N	\N	3月升学季来临：小升初简历里“无效包装”正在拖垮孩子，真正打动名校的3个真实细节	\N	\N	f	ai	t	2026-08-09 14:03:48.857	2026-08-09 14:03:48.857
cmslvic56009ii5cxvznodcyh	教育	topic	\N	\N	春招高峰叠加：成人考教资人暴增47%，但82%卡在《综合素质》作文——阅卷老师亲授破题逻辑	\N	\N	f	ai	t	2026-08-09 14:03:48.858	2026-08-09 14:03:48.858
cmslvic57009ji5cx2abhyh4a	教育	topic	\N	\N	清明假期别只扫墓：带孩子做「家族教育史手账」，悄然激活内驱力（附免费工具包）	\N	\N	f	ai	t	2026-08-09 14:03:48.859	2026-08-09 14:03:48.859
cmslvic58009ki5cxw2dixh71	教育	topic	\N	\N	教育部通报6家机构违规收费：家长签合同前必须核对的4项资质编号（含查询入口）	\N	\N	f	ai	t	2026-08-09 14:03:48.861	2026-08-09 14:03:48.861
cmslvic5b009li5cxn0tjjie0	教育	topic	\N	\N	五一研学扎堆报名：为什么90%家庭花3倍钱却没效果？筛选靠谱研学营的3个硬指标	\N	\N	f	ai	t	2026-08-09 14:03:48.863	2026-08-09 14:03:48.863
cmslvic5c009mi5cxoavn1va3	教育	topic	\N	\N	高考倒计时60天：高三最后阶段，比刷题更重要的3件事（清北毕业班主任实录）	\N	\N	f	ai	t	2026-08-09 14:03:48.865	2026-08-09 14:03:48.865
cmslvic5e009ni5cx5db7tx8c	教育	topic	\N	\N	六一儿童节反套路：不买玩具不报班，送孩子一份「学习主权契约书」（可打印）	\N	\N	f	ai	t	2026-08-09 14:03:48.867	2026-08-09 14:03:48.867
cmslvic5f009oi5cxtpsynyvt	教育	topic	\N	\N	中考冲刺最后30天：物理压轴题总空着？不是不会，是缺这1个解题脚手架（附真题拆解视频）	\N	\N	f	ai	t	2026-08-09 14:03:48.868	2026-08-09 14:03:48.868
cmslvic5g009pi5cxwpukyb87	教育	topic	\N	\N	暑期档提前引爆：K12机构“早鸟价”暗藏3个价格陷阱，聪明家长都在等这个时间节点	\N	\N	f	ai	t	2026-08-09 14:03:48.869	2026-08-09 14:03:48.869
cmslvic5i009qi5cxwqkw3ggh	教育	topic	\N	\N	暑假防沉迷新规落地：把手机时间换算成「知识积分」，孩子主动交出屏幕的实践案例	\N	\N	f	ai	t	2026-08-09 14:03:48.87	2026-08-09 14:03:48.87
cmslvic5j009ri5cx7ycli512	教育	topic	\N	\N	七夕节特别策划：夫妻教育观冲突怎么办？用「教育决策四象限表」3步达成共识	\N	\N	f	ai	t	2026-08-09 14:03:48.872	2026-08-09 14:03:48.872
cmslvic5l009si5cxdk910pp7	教育	topic	\N	\N	教师节前夕：我们偷偷跟拍了12位一线老师下班后的真实生活，这才是专业背后的真相	\N	\N	f	ai	t	2026-08-09 14:03:48.873	2026-08-09 14:03:48.873
cmslvic5n009ti5cx6b6bkuo6	教育	topic	\N	\N	开学前焦虑调查：73%家长因“分班结果”失眠，其实决定孩子三年发展的不是班级，而是这2个动作	\N	\N	f	ai	t	2026-08-09 14:03:48.875	2026-08-09 14:03:48.875
cmslvic5o009ui5cx2pf4hkgi	教育	topic	\N	\N	国庆长假高效利用指南：用「学科盲点扫描表」替代补习班，精准定位提分突破口	\N	\N	f	ai	t	2026-08-09 14:03:48.877	2026-08-09 14:03:48.877
cmslvic5p009vi5cxvne7nuk0	教育	topic	\N	\N	双11教育消费冷静期：课程成交率最高时段其实是11月15日之后，背后有3个数据支撑	\N	\N	f	ai	t	2026-08-09 14:03:48.878	2026-08-09 14:03:48.878
cmslvic5q009wi5cxyjap2elp	教育	topic	\N	\N	教育部等八部门联合发文规范AI教育工具：孩子每天用AI搜答案，正在悄悄废掉这2种核心能力	\N	\N	f	ai	t	2026-08-09 14:03:48.879	2026-08-09 14:03:48.879
cmslvic5s009xi5cx9ce455w9	教育	topic	\N	\N	冬至亲子共学夜：用一碗饺子的时间，带孩子理解“函数图像”的生活原型（附厨房实验视频）	\N	\N	f	ai	t	2026-08-09 14:03:48.88	2026-08-09 14:03:48.88
cmslvic5t009yi5cxd9i25ep0	教育	topic	\N	\N	考研报名启动：往届生最容易填错的5处信息，去年3.2万人因此资格失效（官方截图标注版）	\N	\N	f	ai	t	2026-08-09 14:03:48.882	2026-08-09 14:03:48.882
cmslvic5v009zi5cxt5ok4eg8	教育	topic	\N	\N	圣诞节轻知识企划：“圣诞老人”其实是位顶级项目管理师？用他的年度计划表讲透PMP核心逻辑	\N	\N	f	ai	t	2026-08-09 14:03:48.883	2026-08-09 14:03:48.883
cmslvic5w00a0i5cx0h87dmr1	教育	topic	\N	\N	元旦许愿新趋势：孩子写的“考年级前十”愿望，正在被心理学证实为低效目标——换成这3种表达更易实现	\N	\N	f	ai	t	2026-08-09 14:03:48.884	2026-08-09 14:03:48.884
cmslvic5x00a1i5cxcsg6j3gi	教育	topic	\N	\N	寒假托管乱象调查：某地198元/天的“名师营”，实际师资80%无教师资格证（附核查方法）	\N	\N	f	ai	t	2026-08-09 14:03:48.885	2026-08-09 14:03:48.885
cmslvic5y00a2i5cxmdc81s0b	教育	topic	\N	\N	春节拜年话术升级：亲戚问“孩子成绩”，用这3句高段位回应，既护住自尊又传递教育理念	\N	\N	f	ai	t	2026-08-09 14:03:48.886	2026-08-09 14:03:48.886
cmslvic5z00a3i5cx24bus9tf	教育	topic	\N	\N	世界读书日冷思考：孩子读完就忘？不是记性差，是缺「三级记忆锚点法」（一线语文组长亲授）	\N	\N	f	ai	t	2026-08-09 14:03:48.888	2026-08-09 14:03:48.888
cmslvic6000a4i5cx6emhrgtz	教育	topic	\N	\N	中高考改革深化：2025年起多地取消“标准答案”评分，现在起必须培养孩子的「结论论证力」	\N	\N	f	ai	t	2026-08-09 14:03:48.889	2026-08-09 14:03:48.889
cmslvic6100a5i5cxfd358fac	教育	topic	\N	\N	母亲节特别内容：妈妈不是超人，是孩子第一任「学习教练」——3个无需考证却极有效的教练动作	\N	\N	f	ai	t	2026-08-09 14:03:48.89	2026-08-09 14:03:48.89
cmslvic6300a6i5cxvyql25mq	教育	topic	\N	\N	职业教育法实施两周年：高职生专升本通过率提升至61.3%，但92%人不知道这条免试通道	\N	\N	f	ai	t	2026-08-09 14:03:48.891	2026-08-09 14:03:48.891
cmslvic6400a7i5cx54drhd0h	教育	topic	\N	\N	寒露节气学古诗：用二十四节气重构文言文学习路径，孩子背《陋室铭》不再靠死记	\N	\N	f	ai	t	2026-08-09 14:03:48.893	2026-08-09 14:03:48.893
cmslviqwg00a8i5cxe24nyq34	教育	image_prompt	\N	\N	\N	一张ins风教育产品展示图：简约木质书桌，摆放一套K12全科思维导图教具套装（含彩色荧光标签、可擦写思维板、分阶练习册），自然光从左上角洒落，背景虚化浅灰绿墙面，角落露出一盆龟背竹，整体干净治愈、高质感、柔和滤镜	\N	f	ai	t	2026-08-09 14:04:07.984	2026-08-09 14:04:07.984
cmslviqwj00a9i5cx5ivia849	教育	image_prompt	\N	\N	\N	一张写实风格教育产品展示图：高清特写镜头，一双成人手正翻开《CPA会计实务精讲》纸质教材，书页边缘微卷，旁边放着红蓝双色记号笔、便签纸堆叠、一台打开的笔记本电脑显示真题解析界面，桌面纹理清晰，光线真实均匀	\N	f	ai	t	2026-08-09 14:04:07.987	2026-08-09 14:04:07.987
cmslviqwk00aai5cxh8o3q8m7	教育	image_prompt	\N	\N	\N	一张国潮风教育产品展示图：水墨晕染底纹上浮雕式呈现「状元及第」篆刻印章，环绕立体烫金课程礼盒（含「小升初冲刺·国学+数学双轨课」字样），盒盖掀开一角露出毛笔造型U盘与青花瓷纹样错题本，配朱砂红丝带与祥云暗纹边框	\N	f	ai	t	2026-08-09 14:04:07.989	2026-08-09 14:04:07.989
cmslviqwl00abi5cxzewb6nft	教育	image_prompt	\N	\N	\N	一张ins风线下门店环境图：阳光通透的现代教育空间，原木色阶梯式学习区坐满专注学生（背影为主），墙上挂三幅极简线条插画——「专注」「成长」「突破」，绿植垂落，咖啡吧台旁立着手写字体立牌「今日知识点：费曼学习法」，柔焦暖调	\N	f	ai	t	2026-08-09 14:04:07.99	2026-08-09 14:04:07.99
cmslviqwm00aci5cxirx4c65f	教育	image_prompt	\N	\N	\N	一张写实风格线下门店环境图：广角实景拍摄，明亮宽敞的少儿编程教室，6名小学生围坐圆桌操作平板电脑，屏幕上显示Scratch动画作品，老师半蹲指导（白衬衫+黑框眼镜，胸前工牌清晰可见「李老师｜北师大教育学硕士」），玻璃门上贴有「北京市海淀区示范教学点」铜牌	\N	f	ai	t	2026-08-09 14:04:07.991	2026-08-09 14:04:07.991
cmslviqwn00adi5cx5hry2y76	教育	image_prompt	\N	\N	\N	一张国潮风线下门店环境图：仿古窗棂分割画面，窗内是新中式教育空间——青砖墙嵌「知行合一」木刻匾额，学生穿改良汉服马甲在宣纸屏风前做实验，茶席旁立「AI+国学双师课堂」鎏金立牌，天花垂下灯笼造型护眼灯，整体赭石+黛青主色调	\N	f	ai	t	2026-08-09 14:04:07.992	2026-08-09 14:04:07.992
cmslviqwo00aei5cx7wry6gut	教育	image_prompt	\N	\N	\N	一张ins风教育活动海报图：浅杏色渐变背景，中央悬浮毛玻璃质感圆形框，内含手绘风格家长与孩子击掌剪影，框外环绕轻盈手写字体「9月开学力提升计划｜免费领《学习动力启动包》」，右下角小图标：日历/耳机/笔记本，留白充足、呼吸感强	\N	f	ai	t	2026-08-09 14:04:07.993	2026-08-09 14:04:07.993
cmslviqwp00afi5cxctozrkf8	教育	image_prompt	\N	\N	\N	一张写实风格教育活动海报图：高清摄影构图，真实活动现场抓拍——30人家长沙龙现场，主讲老师（40岁左右女性，干练短发、浅蓝西装）指向投影幕布上的「小学英语启蒙三阶段数据对比图」，台下家长手持笔记，PPT页面清晰可见柱状图与78.6%提分率标注	\N	f	ai	t	2026-08-09 14:04:07.994	2026-08-09 14:04:07.994
cmslviqwq00agi5cx36sjkpi0	教育	image_prompt	\N	\N	\N	一张国潮风教育活动海报图：敦煌飞天飘带动态构图，飞天衣袂化作「暑期集训营」书法字体，下方展开卷轴式排版：左侧「文曲星护航计划」篆书标题，右侧列四大模块图标（青铜器纹样「习惯养成」、活字印刷「方法训练」、榫卯结构「思维建模」、锦鲤游动「成果保障」），朱砂红印章压角	\N	f	ai	t	2026-08-09 14:04:07.995	2026-08-09 14:04:07.995
cmslviqws00ahi5cxjotz5oc5	教育	image_prompt	\N	\N	\N	一张ins风客户案例展示图：拼贴式构图，左为手机屏幕截图（微信聊天记录打码：「老师太懂我家娃了！3周主动预习了！」+五星好评截图），右为手绘成长树简笔画（枝干标「2个月」，三片叶子写「作业不拖拉」「敢举手发言」「数学错题减少62%」），背景米白麻纹纸	\N	f	ai	t	2026-08-09 14:04:07.996	2026-08-09 14:04:07.996
cmslviqwt00aii5cxlyjxfge2	教育	image_prompt	\N	\N	\N	一张写实风格客户案例展示图：纪实摄影风格，北京某重点中学初三男生站在校门口微笑比耶，胸前佩戴「年级进步TOP10」绶带，背后电子屏滚动「2024届中考喜报：王同学物理单科提升41分」，他手中拿着机构结业证书（机构logo与公章清晰可辨）	\N	f	ai	t	2026-08-09 14:04:07.997	2026-08-09 14:04:07.997
cmslviqwu00aji5cxw4lduced	教育	image_prompt	\N	\N	\N	一张国潮风客户案例展示图：皮影戏风格插画场景，主角为戴圆框眼镜的成人学员剪影，身披「中级经济师通关战袍」，脚下踏「刷题山」与「模考海」，头顶祥云托起金色证书，云中浮现二维码与「她38岁，用287天拿下双证」竖排楷书，边框为回纹锦	\N	f	ai	t	2026-08-09 14:04:07.999	2026-08-09 14:04:07.999
cmslviqwv00aki5cxindtwr4m	教育	image_prompt	\N	\N	\N	一张ins风学习氛围图：俯拍视角，浅橡木色长桌铺亚麻桌布，散落彩色便利贴（写有「番茄钟×4」「错题归因法」「今天夸了孩子3次」）、一杯燕麦拿铁、翻开的《父母的觉醒》书页，窗外透进午后阳光，在桌面投下百叶窗光影，静谧而有力量	\N	f	ai	t	2026-08-09 14:04:08	2026-08-09 14:04:08
cmslviqww00ali5cxgcuyqml1	教育	image_prompt	\N	\N	\N	一张写实风格学习氛围图：夜拍真实场景，台灯暖光聚焦书桌——高三女生侧脸专注演算，草稿纸堆叠写满公式，电脑屏显示「高考真题智能诊断报告」，右上角弹出微信消息气泡「张老师刚批完你的作文，说逻辑链完整度达92%」	\N	f	ai	t	2026-08-09 14:04:08.001	2026-08-09 14:04:08.001
cmslvj7zz00ami5cxku0e1gto	微商	title	数字	数字	3个被客户追着问的护肤小动作，第2个连我妈都抢着学	\N	\N	f	ai	t	2026-08-09 14:04:30.136	2026-08-09 14:04:30.136
cmslvj80100ani5cxiv5ljgak	微商	title	反差	反差	朋友圈发100条没人点？试试这1条转化率翻3倍的写法	\N	\N	f	ai	t	2026-08-09 14:04:30.145	2026-08-09 14:04:30.145
cmslvj80200aoi5cxro649eve	微商	title	疑问	疑问	你家产品是不是又涨价了？”——上个月我悄悄做了这件事	\N	\N	f	ai	t	2026-08-09 14:04:30.146	2026-08-09 14:04:30.146
cmslvj80300api5cxoi2wahjw	微商	title	痛点	痛点	凌晨2点还在改文案？90%微商卡在不会写“人话”这一步	\N	\N	f	ai	t	2026-08-09 14:04:30.147	2026-08-09 14:04:30.147
cmslvj80400aqi5cxk19reuop	微商	title	福利	福利	今天加了7个主动咨询的客户，只因我把福利藏在这句话里	\N	\N	f	ai	t	2026-08-09 14:04:30.148	2026-08-09 14:04:30.148
cmslvj80400ari5cxt9fw08f6	微商	title	权威数据	权威数据	卫健委最新报告：68%女性用错精华顺序，你中招没？	\N	\N	f	ai	t	2026-08-09 14:04:30.149	2026-08-09 14:04:30.149
cmslvj80500asi5cxds8o2rrb	微商	title	悬念	悬念	她发完这条朋友圈，3小时收了5单，但没人知道她删了2稿	\N	\N	f	ai	t	2026-08-09 14:04:30.15	2026-08-09 14:04:30.15
cmslvj80600ati5cx8dvodf6o	微商	title	共情	共情	本来只想试试…结果老公偷偷囤了3盒”｜真实下单截图	\N	\N	f	ai	t	2026-08-09 14:04:30.15	2026-08-09 14:04:30.15
cmslvj80700aui5cx8iw838ja	微商	title	故事	故事	上周五凌晨，我在出租屋熬到3点，就为改这句开场白	\N	\N	f	ai	t	2026-08-09 14:04:30.151	2026-08-09 14:04:30.151
cmslvj80800avi5cxnh5jh661	微商	title	清单	清单	私域成交5步清单：从加好友到复购，我全写在备忘录里	\N	\N	f	ai	t	2026-08-09 14:04:30.152	2026-08-09 14:04:30.152
cmslvj80800awi5cx02mem6gj	微商	title	热点	热点	《热辣滚烫》爆火后，客户突然问我：“这个能配减脂餐吃吗？	\N	\N	f	ai	t	2026-08-09 14:04:30.153	2026-08-09 14:04:30.153
cmslvj80900axi5cx4ku5kksv	微商	title	对比	对比	别人卖面膜靠打折，我靠晒早餐+空瓶+娃睡醒第一句话	\N	\N	f	ai	t	2026-08-09 14:04:30.153	2026-08-09 14:04:30.153
cmslvj80900ayi5cxvpfugp9y	微商	title	对比	对比	7天瘦腰5cm？不节食不运动，客户反馈图我都存满了	\N	\N	f	ai	t	2026-08-09 14:04:30.154	2026-08-09 14:04:30.154
cmslvj80a00azi5cxkwoo70zy	微商	title	对比	对比	说“效果慢”的人，90%没做对这1个涂抹手法	\N	\N	f	ai	t	2026-08-09 14:04:30.155	2026-08-09 14:04:30.155
cmslvj80b00b0i5cxopz9bd2t	微商	title	对比	对比	为什么我发圈像广告，你发圈像唠嗑？	\N	\N	f	ai	t	2026-08-09 14:04:30.155	2026-08-09 14:04:30.155
cmslvj80b00b1i5cx9wq3vxpz	微商	title	对比	对比	库存只剩23套！做完这波活动我就停掉代理价	\N	\N	f	ai	t	2026-08-09 14:04:30.156	2026-08-09 14:04:30.156
cmslvj80c00b2i5cxgawf2thm	微商	title	对比	对比	买一送二？不，这次我直接把试用装+教程+1v1指导全塞进包裹	\N	\N	f	ai	t	2026-08-09 14:04:30.157	2026-08-09 14:04:30.157
cmslvj80d00b3i5cxpfp8mkxx	微商	title	对比	对比	中国营养学会认证：益生菌活菌数＞100亿才真正起效	\N	\N	f	ai	t	2026-08-09 14:04:30.157	2026-08-09 14:04:30.157
cmslvj80e00b4i5cxnfa1qpwg	微商	title	对比	对比	她连发3天“今天没发货”，第4天订单暴增200%	\N	\N	f	ai	t	2026-08-09 14:04:30.158	2026-08-09 14:04:30.158
cmslvj80e00b5i5cxmbwktv0i	微商	title	对比	对比	上次说不要了，这次怎么又来问？”｜一位老客的第7次回购	\N	\N	f	ai	t	2026-08-09 14:04:30.159	2026-08-09 14:04:30.159
cmslvj80g00b6i5cximhny66t	微商	title	对比	对比	昨天带娃打疫苗排队时，随手拍的对比图被转发了12次	\N	\N	f	ai	t	2026-08-09 14:04:30.16	2026-08-09 14:04:30.16
cmslvj80g00b7i5cx74k8yd94	微商	title	对比	对比	新手起步必备的6件套：手机支架、话术本、快递单模板…	\N	\N	f	ai	t	2026-08-09 14:04:30.161	2026-08-09 14:04:30.161
cmslvj80h00b8i5cx34v1vw51	微商	title	对比	对比	春节返乡潮刚退，已有17位阿姨找我订“走亲戚伴手礼	\N	\N	f	ai	t	2026-08-09 14:04:30.162	2026-08-09 14:04:30.162
cmslvj80i00b9i5cx02amrm5n	微商	title	对比	对比	李佳琦直播间同款胶原棒，我们工厂直供价只要1/3	\N	\N	f	ai	t	2026-08-09 14:04:30.163	2026-08-09 14:04:30.163
cmslvj80j00bai5cxfcf5auxd	微商	title	对比	对比	95后宝妈靠朋友圈副业月入2W+，她的第一条成交记录是这样来的	\N	\N	f	ai	t	2026-08-09 14:04:30.163	2026-08-09 14:04:30.163
cmslvj80k00bbi5cxpdrq47f6	微商	title	对比	对比	别人都说没用，我坚持28天后…”｜素颜照我放最前面	\N	\N	f	ai	t	2026-08-09 14:04:30.164	2026-08-09 14:04:30.164
cmslvj80k00bci5cx668oygwj	微商	title	对比	对比	发圈总被折叠？试试把“产品名”换成“我今早喝的第三杯	\N	\N	f	ai	t	2026-08-09 14:04:30.165	2026-08-09 14:04:30.165
cmslvj80l00bdi5cxptpmpn3k	微商	title	对比	对比	客户说“再看看”，我回了这句话，30分钟后她下了单	\N	\N	f	ai	t	2026-08-09 14:04:30.165	2026-08-09 14:04:30.165
cmslvj80l00bei5cxq1k62e40	微商	title	对比	对比	前天刚寄出的50份赠品，附了张手写便签，返图率超80%	\N	\N	f	ai	t	2026-08-09 14:04:30.166	2026-08-09 14:04:30.166
cmslvj80m00bfi5cx9uyak3i0	微商	title	对比	对比	天猫数据：2024Q1敏感肌护理搜索量涨217%，你跟上了吗？	\N	\N	f	ai	t	2026-08-09 14:04:30.166	2026-08-09 14:04:30.166
cmslvj80n00bgi5cxshl5yj3r	微商	title	对比	对比	你朋友圈怎么老有新东西？”｜其实我只是每天多记3个生活细节	\N	\N	f	ai	t	2026-08-09 14:04:30.167	2026-08-09 14:04:30.167
cmslvj80n00bhi5cx39eplnug	微商	title	对比	对比	产后斑反反复复？3位妈妈的真实改善周期表（附时间轴）	\N	\N	f	ai	t	2026-08-09 14:04:30.168	2026-08-09 14:04:30.168
cmslvj80o00bii5cxj8qmgjq0	微商	title	对比	对比	不是不想买，是怕踩雷”——我把所有检测报告拍成了九宫格	\N	\N	f	ai	t	2026-08-09 14:04:30.168	2026-08-09 14:04:30.168
cmslvj80o00bji5cxmc5beart	微商	title	对比	对比	护肤清单我列了12版，最后留下的只有这5样	\N	\N	f	ai	t	2026-08-09 14:04:30.169	2026-08-09 14:04:30.169
cmslvj80p00bki5cxl4tawsrp	微商	title	对比	对比	《繁花》带火的老上海味零食，我们改良成低糖版上线3天售罄	\N	\N	f	ai	t	2026-08-09 14:04:30.169	2026-08-09 14:04:30.169
cmslvj80p00bli5cxuzwt2ubt	微商	title	对比	对比	A用某大牌要299，B用我们同源原料只要89，差在哪？	\N	\N	f	ai	t	2026-08-09 14:04:30.17	2026-08-09 14:04:30.17
cmslvj80q00bmi5cxziq5q6zm	微商	title	对比	对比	1个动作让回购率从12%飙到63%，团队新人培训必讲	\N	\N	f	ai	t	2026-08-09 14:04:30.17	2026-08-09 14:04:30.17
cmslvj80q00bni5cxtyw1agci	微商	title	对比	对比	你家客服比我还懂我家娃作息”｜客户发来的夸夸截图	\N	\N	f	ai	t	2026-08-09 14:04:30.171	2026-08-09 14:04:30.171
cmslvj80r00boi5cx6t2pc9vg	微商	title	对比	对比	为什么同样发“今日发货”，有人被点赞，有人被屏蔽？	\N	\N	f	ai	t	2026-08-09 14:04:30.171	2026-08-09 14:04:30.171
cmslvj80r00bpi5cxmbe09b1n	微商	title	对比	对比	本来只订1盒，结果打包时多塞了2包”｜仓库小妹的日常	\N	\N	f	ai	t	2026-08-09 14:04:30.172	2026-08-09 14:04:30.172
cmslvj80s00bqi5cxqx3hb2pc	微商	title	对比	对比	刚和代工厂确认：下批货新增独立铝膜+防伪码，今晚同步	\N	\N	f	ai	t	2026-08-09 14:04:30.172	2026-08-09 14:04:30.172
cmslvj80s00bri5cxmi70b610	微商	title	对比	对比	丁香医生背书的成分表，我们每批次都公开检测编号	\N	\N	f	ai	t	2026-08-09 14:04:30.173	2026-08-09 14:04:30.173
cmslvj80t00bsi5cxr7xc9yvn	微商	title	对比	对比	她截了我3条旧朋友圈发给闺蜜：“你看她像不像在帮你选？	\N	\N	f	ai	t	2026-08-09 14:04:30.173	2026-08-09 14:04:30.173
cmslvj80u00bti5cx4p06a7mi	微商	title	对比	对比	孩子过敏那周，我边擦药膏边哭，后来试了这个…	\N	\N	f	ai	t	2026-08-09 14:04:30.174	2026-08-09 14:04:30.174
cmslvj80u00bui5cx0omsva6c	微商	title	对比	对比	凌晨改完方案，顺手拍了窗台绿萝新冒的芽｜配文：生长是静音的	\N	\N	f	ai	t	2026-08-09 14:04:30.175	2026-08-09 14:04:30.175
cmslvj80v00bvi5cxfre1awcd	微商	title	对比	对比	新手避坑指南：这8种话术千万别发，尤其第5条	\N	\N	f	ai	t	2026-08-09 14:04:30.175	2026-08-09 14:04:30.175
cmslvj80w00bwi5cxycvwd5dp	微商	title	对比	对比	淄博烧烤火了之后，客户开始问：“你们酵素能配烧烤吃吗？	\N	\N	f	ai	t	2026-08-09 14:04:30.176	2026-08-09 14:04:30.176
cmslvj80x00bxi5cx4ufobod7	微商	title	对比	对比	别人强调“美白”，我们强调“晒后修护第3小时该做什么	\N	\N	f	ai	t	2026-08-09 14:04:30.177	2026-08-09 14:04:30.177
cmslvj80x00byi5cxmsk985as	微商	title	对比	对比	5个让客户主动截图问链接的封面设计技巧	\N	\N	f	ai	t	2026-08-09 14:04:30.178	2026-08-09 14:04:30.178
cmslvj80y00bzi5cxujlth7ry	微商	title	对比	对比	说好不囤货，结果又下单了”｜第5次回购的备注让我笑了	\N	\N	f	ai	t	2026-08-09 14:04:30.178	2026-08-09 14:04:30.178
cmslvj80y00c0i5cxtrn7egwe	微商	title	对比	对比	为什么客户宁愿等3天也不去拼多多？答案藏在物流面单里	\N	\N	f	ai	t	2026-08-09 14:04:30.179	2026-08-09 14:04:30.179
cmslvj80z00c1i5cxy3qdxg7c	微商	title	对比	对比	赠品不是随便送的！我们把试用装做成「体验进度条」	\N	\N	f	ai	t	2026-08-09 14:04:30.179	2026-08-09 14:04:30.179
cmslvj80z00c2i5cx519vedde	微商	title	对比	对比	刚刚查完库存：爆款胶原饮还剩最后117瓶，补货要等15天	\N	\N	f	ai	t	2026-08-09 14:04:30.18	2026-08-09 14:04:30.18
cmslvj81000c3i5cxcy5l7br4	微商	title	对比	对比	国家药监局备案号全公开，扫码就能看每一批次检验报告	\N	\N	f	ai	t	2026-08-09 14:04:30.181	2026-08-09 14:04:30.181
cmslvj81100c4i5cx7dkh80lw	微商	title	对比	对比	上次推荐给我妈，这次她拉着跳广场舞的姐妹一起来问	\N	\N	f	ai	t	2026-08-09 14:04:30.182	2026-08-09 14:04:30.182
cmslvj81200c5i5cxydzc0nbq	微商	title	对比	对比	产科护士长私聊我说：“你们的妊娠纹霜，我科室都在用	\N	\N	f	ai	t	2026-08-09 14:04:30.182	2026-08-09 14:04:30.182
cmslvj81300c6i5cxclxufxpp	微商	title	对比	对比	带娃逛公园时拍的娃抓握小手视频，意外成了最佳种草素材	\N	\N	f	ai	t	2026-08-09 14:04:30.183	2026-08-09 14:04:30.183
cmslvj81300c7i5cxu7vo42no	微商	title	对比	对比	私域运营黄金48小时清单：加好友→首聊→首单→首评→首转介绍	\N	\N	f	ai	t	2026-08-09 14:04:30.184	2026-08-09 14:04:30.184
cmslvj81400c8i5cx6koi5r75	微商	title	对比	对比	奥运健儿同款	\N	\N	f	ai	t	2026-08-09 14:04:30.184	2026-08-09 14:04:30.184
cmslvk7cu00c9i5cxnpaz4f7o	微商	article	新客引流	\N	\N	刚加好友的姐妹别划走～今天泡了杯玫瑰胶原饮，小肚子暖暖的，连喝5天皮肤摸起来软乎乎的✨没做广告，就是顺手拍了张办公桌上的杯子——结果隔壁部门姐姐追着要链接😂如果你也常熬夜/姨妈期脸垮/喝白水都嫌淡，我这有份「新手友好清单」：0添加糖、3秒冲开、喝完不反酸。评论区扣【1】，我私你试喝装地址（限前20名，手慢真没了）	\N	f	ai	t	2026-08-09 14:05:15.965	2026-08-09 14:05:15.965
cmslvk7cw00cai5cxed3i6y28	微商	article	老客复购	\N	\N	早上被客户微信戳醒：“姐，上个月买的酵素果冻我囤了3箱！”她发来冰箱照片，最上层还贴着张便签：“给婆婆的，她便秘十年头回自己蹲厕所笑了…”我愣住，原来我们卖的不是零食，是老人憋了十年的一口气。现在新客进群，送《家庭肠道自查表》+试吃装，不推销，只陪你把身体理顺。	\N	f	ai	t	2026-08-09 14:05:15.968	2026-08-09 14:05:15.968
cmslvk7cx00cbi5cxh6ktd3yq	微商	article	产品种草	\N	\N	昨天整理聊天记录，翻到去年3月第一条成交：客户说“就当支持你创业”。今天她第7次回购益生菌，备注写：“孩子过敏少了，我也敢穿裙子了。”信任不是靠话术堆出来的，是她每次经期前准时找我订暖宫膏，是我记得她老公戒烟第87天该补B族…新朋友，先加我，再慢慢聊你的小困扰🌿	\N	f	ai	t	2026-08-09 14:05:15.97	2026-08-09 14:05:15.97
cmslvk7cy00cci5cxxbzznhxo	微商	article	客户见证	\N	\N	今早煮燕窝时烫了手，但看到订单弹窗笑了——第3次回购的宝妈说：“宝宝湿疹退了，我终于敢抱他晒太阳。”她发来娃光脚踩沙子的照片，脚踝上还有淡淡红印，但笑容比海还亮🌊我们不做“包治百病”的梦，只守好每一批原料溯源码。新客首单赠《燕窝避坑指南》，扫码领，不套路。	\N	f	ai	t	2026-08-09 14:05:15.971	2026-08-09 14:05:15.971
cmslvk7cz00cdi5cxtf7ga0hm	微商	article	节假日活动	\N	\N	端午快到了，老家寄来一筐青梅，我熬了三锅梅子酱，分给老客户当伴手礼。有个姐姐收到后发语音：“这味道像我妈腌的…”突然就红了眼眶。原来最贵的不是包装盒，是那份“我记得你提过想尝家乡味”的用心。这个端午，下单就送手写贺卡+青梅茶包，限量50份，写完最后一张就停。	\N	f	ai	t	2026-08-09 14:05:15.971	2026-08-09 14:05:15.971
cmslvk7d000cei5cx15l7q5rl	微商	article	品牌故事	\N	\N	三年前我在出租屋阳台种薄荷，失败7次，最后靠邻居阿姨教的土法育苗活了。后来发现：好东西从不用P图说话，就像我们家的艾草足贴，原料来自南阳古法种植基地，每片都有田间实拍二维码。不讲大道理，只说人话——你缺的不是产品，是愿意陪你慢慢养好的人。	\N	f	ai	t	2026-08-09 14:05:15.972	2026-08-09 14:05:15.972
cmslvk7d000cfi5cxyjepoheu	微商	article	上新公告	\N	\N	新品「晨光酵素软糖」上线！不是药片不是饮料，是嚼着酸酸甜甜的苹果味，吃完还想舔手指的那种小确幸🍎研发时熬了11版配方，去掉所有人工香精，连色素都用黑加仑提取。第一批试吃员说：“比奶茶还上头，但腰围真小了2cm。”今天前50名下单，送定制日历+剥糖纸小镊子，仪式感拉满～	\N	f	ai	t	2026-08-09 14:05:15.973	2026-08-09 14:05:15.973
cmslvk7d100cgi5cxy0nm90cx	微商	article	优惠活动	\N	\N	听说你囤年货总怕踩雷？我们把今年爆款TOP3打包成「安心年货匣」：①无添加山楂条（娃抢着吃）②古法黑芝麻丸（婆婆夸酥而不腻）③独立小包装坚果（开会摸口袋不尴尬）。原价299，双十二当天199，还塞进一张手写福字贴。库存只剩87组，抢完等明年。	\N	f	ai	t	2026-08-09 14:05:15.974	2026-08-09 14:05:15.974
cmslvk7d200chi5cx3fu64fs2	微商	article	知识科普	\N	\N	很多人问我：“酵素到底有没有用？”上周带爸妈体检，医生指着报告说：“肠道菌群比同龄人年轻8岁。”我没接话，只是默默打开手机相册——翻出半年前他们便秘捂肚子的照片，和现在晨跑打卡的视频。科学不说谎，但改变需要时间。想了解原理？私我领《酵素冷知识手册》，配真实检测报告截图。	\N	f	ai	t	2026-08-09 14:05:15.975	2026-08-09 14:05:15.975
cmslvk7d300cii5cx9cr29xpv	微商	article	互动话题	\N	\N	你最近气色怎么这么好？	\N	f	ai	t	2026-08-09 14:05:15.976	2026-08-09 14:05:15.976
cmslvk7d400cji5cxb3jpyi6t	微商	article	答疑辟谣	\N	\N	偷偷换了洗发水	\N	f	ai	t	2026-08-09 14:05:15.977	2026-08-09 14:05:15.977
cmslvk7d500cki5cx6c0ljfap	微商	article	会员权益	\N	\N	啥牌子？	\N	f	ai	t	2026-08-09 14:05:15.977	2026-08-09 14:05:15.977
cmslvk7d500cli5cx4kz8za7a	微商	article	会员权益	\N	\N	不告诉你，怕你抢我代工厂”（笑）	\N	f	ai	t	2026-08-09 14:05:15.978	2026-08-09 14:05:15.978
cmslvk7d600cmi5cx8a2c4jn2	微商	article	会员权益	\N	\N	其实是我们自研的侧柏叶生姜洗发皂，洗完头皮会呼吸，掉发少了一半。评论区揪3个姐妹，免费寄旅行装+头皮检测表。别问功效，先感受——毕竟头发不会说谎，它只忠于你给的养分。	\N	f	ai	t	2026-08-09 14:05:15.979	2026-08-09 14:05:15.979
cmslvk7d700cni5cx4utrb6kf	微商	article	会员权益	\N	\N	客户问：“你们益生菌能治幽门螺杆菌吗？	\N	f	ai	t	2026-08-09 14:05:15.98	2026-08-09 14:05:15.98
cmslvk7d800coi5cxegtr5erh	微商	article	会员权益	\N	\N	我立刻截图发给她三甲医院消化科主任的科普文：“益生菌不是药，但能帮抗生素‘站好岗’。”然后补了句：“如果你在吃四联疗法，我帮你配服药时间表+舒缓胃膜的山药粉。”不神化产品，只做你能查证的事。需要这份《用药协同指南》？私我。	\N	f	ai	t	2026-08-09 14:05:15.98	2026-08-09 14:05:15.98
cmslvk7d900cpi5cxmz49qg4m	微商	article	会员权益	\N	\N	加入「晨光会员」第3天，我就收到专属提醒：“你上次买的胶原饮快喝完了，补货享85折。”生日月自动升级体验装，连快递盒都印着我的昵称。没有复杂等级，只有“你值得被记住”的温柔。现在开通，立得200积分（可兑燕窝/运费券/手写贺卡），不绑定银行卡，随时退。	\N	f	ai	t	2026-08-09 14:05:15.981	2026-08-09 14:05:15.981
cmslvkm0k00dbi5cxxsfjtoy4	微商	topic	\N	\N	梅雨季衣服总泛潮味？我晾完衬衫喷了两下除味喷雾，老公闻完说“这味道像晒过太阳的棉布	\N	\N	f	ai	t	2026-08-09 14:05:34.964	2026-08-09 14:05:34.964
cmslvk7d900cqi5cx6mhk7f9z	微商	article	会员权益	\N	\N	朋友介绍来的妹妹今天加我，第一句话是：“我乳腺结节三年了，能喝你们的蒲公英茶吗？”我没推产品，先发了份《结节人群饮食红绿灯》，标注哪些成分需避开。她回复：“第一次有人不急着卖我东西。”信任不是开口就要成交，而是你开口前，我已经准备好答案。	\N	f	ai	t	2026-08-09 14:05:15.982	2026-08-09 14:05:15.982
cmslvk7da00cri5cxyd246ny2	微商	article	会员权益	\N	\N	凌晨2点改完方案，泡了杯桂圆红枣茶，甜味刚漫上来，手机震了——老客户发来产检报告：“胎心142，医生说营养跟得上。”她怀孕全程喝我们的孕妇款蛋白粉，连孕吐期都坚持每天一杯。原来所谓靠谱，就是你人生重大时刻，我的产品稳稳接住你。新客进群，送《孕期营养节奏表》。	\N	f	ai	t	2026-08-09 14:05:15.982	2026-08-09 14:05:15.982
cmslvk7da00csi5cx2vkkn19g	微商	article	会员权益	\N	\N	中秋那晚陪婆婆赏月，她突然说：“你这枸杞糕比药房买的甜，还不齁嗓子。”我笑着递上新做的桂花乌梅膏：“妈，试试这个，解腻又护胃。”节日不该只有促销，更该有“我把最好吃的留给你”的笨拙心意。下单即赠手作月光笺，写满祝福再寄出。	\N	f	ai	t	2026-08-09 14:05:15.983	2026-08-09 14:05:15.983
cmslvk7db00cti5cxmgban42m	微商	article	会员权益	\N	\N	上周末回乡下收艾草，蹲在田埂拍视频时，遇见十年前教我辨药材的老药农。他捏碎叶子闻了闻：“嗯，火候刚好。”那一刻突然懂了：所谓传承，不是喊口号，是把古法晒足72小时，宁可少赚也不用烘干机。新客首单，送《艾草手札》+晒制过程实拍卡。	\N	f	ai	t	2026-08-09 14:05:15.983	2026-08-09 14:05:15.983
cmslvk7dc00cui5cxx2dzqu83	微商	article	会员权益	\N	\N	「云朵舒缓霜」终于来了！专为换季泛红、口罩脸、空调房干痒设计。不含酒精/香精/激素，抹开是云朵般的绵密感，3分钟褪红。首批试用者反馈：“涂完敢素颜去家长会了。”今天开放预约，前30名送冰感按摩滚珠+敏感肌自查表，不讲成分党术语，只说一句：“脸不闹脾气的日子，真的会上瘾。	\N	f	ai	t	2026-08-09 14:05:15.984	2026-08-09 14:05:15.984
cmslvk7dc00cvi5cx7iatwip4	微商	article	会员权益	\N	\N	昨天帮客户查物流，发现她三年买了27单，最常买的是护眼软糖和蓝莓冻干。我翻聊天记录，原来她儿子近视加深慢了，自己看电脑不干涩了。没发朋友圈炫耀业绩，只默默做了张《用眼健康日历》，标注每个时段该吃什么、盯屏多久要休息…需要的，我私你PDF版。	\N	f	ai	t	2026-08-09 14:05:15.985	2026-08-09 14:05:15.985
cmslvk7dd00cwi5cxtjw3008f	微商	article	会员权益	\N	\N	冬至这天，厨房炖着当归羊肉汤，砂锅咕嘟响，手机弹出消息：“姐，我按你说的喝姜枣茶一周，手脚不冰了！”她发来晨练照片，马尾辫甩得高高的。节气不是营销借口，是我们祖辈留下的养生刻度。今日下单，加赠「冬至九九养生手账」，手绘节气食谱+打卡格。	\N	f	ai	t	2026-08-09 14:05:15.985	2026-08-09 14:05:15.985
cmslvk7dd00cxi5cx7zzy2929	微商	article	会员权益	\N	\N	有客户私聊：“你们燕窝是不是假的？抖音说99%都是糖水。”我直接发她海关报关单+实验室检测报告，又补了句：“你随时可以寄第三方复检，费用我出。”真金不怕火炼，真心不怕质疑。想看原料溯源全过程？私我领《燕窝透明之旅》视频合集。	\N	f	ai	t	2026-08-09 14:05:15.986	2026-08-09 14:05:15.986
cmslvk7de00cyi5cxipnan4t1	微商	article	会员权益	\N	\N	会员日专属福利来啦！今天起，所有晨光会员生日当周，自动解锁「宠爱盲盒」：可能是加量装、手写感恩卡、或一次15分钟健康咨询。不设门槛，不搞抽奖，就是单纯想说：“谢谢你一直记得我。”还没加入？扫码即享首单折上折，无隐形条款。	\N	f	ai	t	2026-08-09 14:05:15.986	2026-08-09 14:05:15.986
cmslvk7de00czi5cxb9c12r1q	微商	article	会员权益	\N	\N	凌晨改PPT饿了，顺手撕开一包山药脆片，咔嚓声治愈到想哭。这不是零食，是河南温县垆土山药切片低温烘烤18小时的诚意。客户说：“比薯片健康，比水果解馋。”新客下单，送《办公室抗饿指南》电子版——含5种低GI零食搭配法，打工人续命刚需。	\N	f	ai	t	2026-08-09 14:05:15.987	2026-08-09 14:05:15.987
cmslvk7df00d0i5cxgo0wxwrf	微商	article	会员权益	\N	\N	闺蜜结婚前焦虑到暴食，我寄去「情绪平衡礼盒」：L-茶氨酸软糖+薰衣草助眠膏+手写开导信。她婚礼当天发来照片：捧花里藏着一小包软糖，背面写着“稳住，你超棒”。产品治不了人生难题，但我们可以陪你稳住呼吸。新客私我【稳住】，领同款心理能量包。	\N	f	ai	t	2026-08-09 14:05:15.987	2026-08-09 14:05:15.987
cmslvk7df00d1i5cx25o0ou9c	微商	article	会员权益	\N	\N	春节返程前，给爸妈塞了3样东西：护膝、黑芝麻丸、还有张手写纸条：“妈，您泡脚水温度调低2度，爸，您降压药饭后半小时吃。”爱不用大声说，藏在细节里。节日期间下单，加赠《家庭健康备忘录》手账本，记录血压/血糖/用药时间，字迹我都替你描好边。	\N	f	ai	t	2026-08-09 14:05:15.988	2026-08-09 14:05:15.988
cmslvk7dg00d2i5cxhrjlotjl	微商	article	会员权益	\N	\N	有姐妹问：“你们益生菌和药店卖的有啥区别？”我拍了张对比图：左边是某品牌配料表里的“植物乳杆菌”，右边是我们检测报告里的活菌数曲线——从出厂到你拆封，每瓶≥100亿CFU。不玩文字游戏，只晒硬数据。需要完整报告？私我发你。	\N	f	ai	t	2026-08-09 14:05:15.988	2026-08-09 14:05:15.988
cmslvk7dg00d3i5cxww083jpw	微商	article	会员权益	\N	\N	昨天带女儿逛菜场，她指着山药说：“妈妈，你家那个白白的粉粉的！”回家翻出客户反馈：“喝完舌苔变薄了”“体检肝酶正常了”“连喝俩月指甲不竖纹了”…原来最打动人的从来不是销量，是身体悄悄变好的证据。新客进群，送《身体信号解码手册》。	\N	f	ai	t	2026-08-09 14:05:15.989	2026-08-09 14:05:15.989
cmslvk7dh00d4i5cx6whpa9fi	微商	article	会员权益	\N	\N	清明回乡祭祖，顺路去了合作的蒲公英种植基地。采茶阿婆教我辨嫩芽：“要带露水摘，	\N	f	ai	t	2026-08-09 14:05:15.989	2026-08-09 14:05:15.989
cmslvkm0c00d5i5cxzl6phufo	微商	topic	\N	\N	春天过敏季来了，我连续用了一周的舒缓喷雾，连熬夜带换季都没起疹子（附客户同款反馈图）	\N	\N	f	ai	t	2026-08-09 14:05:34.951	2026-08-09 14:05:34.951
cmslvkm0g00d6i5cxbbl9dxby	微商	topic	\N	\N	清明踏青前囤了3盒便携湿巾，小包装塞进外套口袋不占地，婆婆说比纸巾还软乎	\N	\N	f	ai	t	2026-08-09 14:05:34.96	2026-08-09 14:05:34.96
cmslvkm0h00d7i5cxm01nuybb	微商	topic	\N	\N	五一出游前悄悄上新了防水防晒唇膏，高铁上补涂三次都不沾杯，闺蜜追着要链接	\N	\N	f	ai	t	2026-08-09 14:05:34.961	2026-08-09 14:05:34.961
cmslvkm0i00d8i5cxm5vkcz2v	微商	topic	\N	\N	儿童节那天发了条朋友圈：女儿用我的儿童防晒霜涂完小胳膊，转头说“妈妈你的比我的还香	\N	\N	f	ai	t	2026-08-09 14:05:34.962	2026-08-09 14:05:34.962
cmslvkm0i00d9i5cxv9ycsfrl	微商	topic	\N	\N	端午前试了三天手作艾草香囊，缝得歪歪扭扭但邻居阿姨抢订5个，说比药店卖的还驱蚊	\N	\N	f	ai	t	2026-08-09 14:05:34.963	2026-08-09 14:05:34.963
cmslvkm0j00dai5cx5cehycrf	微商	topic	\N	\N	618不搞满减，只送「下单就寄试用装」——昨天发完，私聊爆了，3个老客直接拍了2箱	\N	\N	f	ai	t	2026-08-09 14:05:34.964	2026-08-09 14:05:34.964
cmslvkm0k00dci5cxiwxyjjuq	微商	topic	\N	\N	暑假带娃回老家，行李箱里塞了6包即食燕窝，高铁上泡一杯，邻座宝妈扫码加我就为问在哪买	\N	\N	f	ai	t	2026-08-09 14:05:34.965	2026-08-09 14:05:34.965
cmslvkm0l00ddi5cxsh89l24z	微商	topic	\N	\N	七夕没发促销，发了张和老公拌嘴后他默默放在我梳妆台上的玫瑰护手霜照片	\N	\N	f	ai	t	2026-08-09 14:05:34.966	2026-08-09 14:05:34.966
cmslvkm0m00dei5cxtk7ojkq8	微商	topic	\N	\N	立秋当天煮了第一锅银耳羹，顺手拍了勺子搅开的胶质拉丝图，配文“润得比空调房还舒服	\N	\N	f	ai	t	2026-08-09 14:05:34.966	2026-08-09 14:05:34.966
cmslvkm0n00dfi5cxbt4a9bxj	微商	topic	\N	\N	开学季帮表姐家孩子抢到限量版卡通保温杯，发货前特意拍了杯身360°无瑕疵视频	\N	\N	f	ai	t	2026-08-09 14:05:34.967	2026-08-09 14:05:34.967
cmslvkm0n00dgi5cxgui74ew0	微商	topic	\N	\N	中秋前试做了桂花乌龙茶冻干，泡开一秒化开，客户说“喝出外婆院里那棵桂树的味道	\N	\N	f	ai	t	2026-08-09 14:05:34.968	2026-08-09 14:05:34.968
cmslvkm0o00dhi5cxoykzednr	微商	topic	\N	\N	国庆自驾游路上，车载香薰用到最后一格，随手拍了空瓶+窗外山景，评论区全是“求补货	\N	\N	f	ai	t	2026-08-09 14:05:34.968	2026-08-09 14:05:34.968
cmslvkm0o00dii5cx87kh0mao	微商	topic	\N	\N	双11我关掉了购物车，开了个「旧物换新礼」活动：拿去年买的面膜盒，就能换今年新品小样	\N	\N	f	ai	t	2026-08-09 14:05:34.969	2026-08-09 14:05:34.969
cmslvkm0p00dji5cxsc2qpn4w	微商	topic	\N	\N	入冬前把暖宫贴贴在腰后拍了张侧影照，配文“不是怕冷，是怕来姨妈时不敢弯腰捡笔	\N	\N	f	ai	t	2026-08-09 14:05:34.969	2026-08-09 14:05:34.969
cmslvkm0p00dki5cxi9p7z4p4	微商	topic	\N	\N	圣诞夜裹着毛毯拆快递，镜头对准刚到的羊毛袜+热红酒杯，弹幕式文案：“脚暖了，心就稳了	\N	\N	f	ai	t	2026-08-09 14:05:34.97	2026-08-09 14:05:34.97
cmslvkm0q00dli5cxndndv01j	微商	topic	\N	\N	元旦倒计时发了张年度复盘截图：27个老客主动帮我转介绍，没发过一条广告	\N	\N	f	ai	t	2026-08-09 14:05:34.97	2026-08-09 14:05:34.97
cmslvkm0q00dmi5cxqhe3jvvj	微商	topic	\N	\N	春节回家前给全家备齐「返乡急救包」：薄荷糖、颈枕、免洗喷雾、暖宝宝，清单被表妹抄走打印	\N	\N	f	ai	t	2026-08-09 14:05:34.971	2026-08-09 14:05:34.971
cmslvkm0r00dni5cxoihpo1su	微商	topic	\N	\N	元宵节煮汤圆时顺手拍了黑芝麻流心特写，配文“馅儿比去年更浓，我妈尝完说像小时候灶台边的味道	\N	\N	f	ai	t	2026-08-09 14:05:34.971	2026-08-09 14:05:34.971
cmslvkm0r00doi5cxrzqzizf4	微商	topic	\N	\N	情人节不卖玫瑰，卖「情侣共用护肤套装」：男生剃须后用控油乳，女生敷完面膜用同系列精华	\N	\N	f	ai	t	2026-08-09 14:05:34.972	2026-08-09 14:05:34.972
cmslvkm0s00dpi5cxj72hfato	微商	topic	\N	\N	3·8妇女节那天没喊口号，发了段语音：“今天给自己买了支口红，色号叫‘不商量’	\N	\N	f	ai	t	2026-08-09 14:05:34.973	2026-08-09 14:05:34.973
cmslvkm0t00dqi5cxazlhypz9	微商	topic	\N	\N	春分前后开始喝枸杞菊花茶，玻璃罐装好拍照发圈，底下备注“每罐少放5颗糖，甜度刚刚好	\N	\N	f	ai	t	2026-08-09 14:05:34.973	2026-08-09 14:05:34.973
cmslvkm0t00dri5cx0u835v5f	微商	topic	\N	\N	谷雨时节试了新采的桑葚酵素粉，冲开是淡紫色，女儿说像“会发光的果汁	\N	\N	f	ai	t	2026-08-09 14:05:34.974	2026-08-09 14:05:34.974
cmslvkm0u00dsi5cxhz25cf6z	微商	topic	\N	\N	五一调休前两天，客户突然私聊问“你们家那个小蓝瓶是不是快断货”，我秒回“还剩最后17瓶	\N	\N	f	ai	t	2026-08-09 14:05:34.974	2026-08-09 14:05:34.974
cmslvkm0u00dti5cx6idivjb5	微商	topic	\N	\N	端午粽叶飘香时，同步上线青黛色真丝眼罩，客户收到后发来午睡照：“梦里都在夸它凉	\N	\N	f	ai	t	2026-08-09 14:05:34.975	2026-08-09 14:05:34.975
cmslvkm0v00dui5cx7rzua14u	微商	topic	\N	\N	618大促当晚，我关掉手机去跳了40分钟操，朋友圈只发一句：“身体账户余额，比购物车更重要	\N	\N	f	ai	t	2026-08-09 14:05:34.975	2026-08-09 14:05:34.975
cmslvkm0v00dvi5cxc6cmq6nz	微商	topic	\N	\N	七夕前夜整理聊天记录，翻出12条客户说“你推荐的真的有用”，挑3条截图发圈	\N	\N	f	ai	t	2026-08-09 14:05:34.976	2026-08-09 14:05:34.976
cmslvkm0w00dwi5cxqi4ai6uj	微商	topic	\N	\N	白露一到皮肤干得抓痒，我连夜拍了晨间护肤vlog：水→精华→面霜→按摩仪，全程没提价格	\N	\N	f	ai	t	2026-08-09 14:05:34.976	2026-08-09 14:05:34.976
cmslvkm0w00dxi5cxjjbvjd6a	微商	topic	\N	\N	双十二不做预售，做「盲盒体验装」：9.9元随机发3样，有人抽中明星同款，晒单返现	\N	\N	f	ai	t	2026-08-09 14:05:34.977	2026-08-09 14:05:34.977
cmslvkm0x00dyi5cxgz0p99bp	微商	topic	\N	\N	腊八节熬粥时顺手拍了红枣枸杞特写，配文“今年没加糖，但甜得踏实——因为知道你会来	\N	\N	f	ai	t	2026-08-09 14:05:34.977	2026-08-09 14:05:34.977
cmslvl0fu00dzi5cx69acz6iw	微商	image_prompt	\N	\N	\N	产品展示-ins风：浅木纹背景上摆着三款天然植物精华小棕瓶，柔光漫射，瓶身微反光，旁边散落几片干玫瑰花瓣与一枝新鲜迷迭香，整体色调低饱和奶油白+灰粉，极简干净，适合朋友圈高质感种草	\N	f	ai	t	2026-08-09 14:05:53.657	2026-08-09 14:05:53.657
cmslvl0fz00e0i5cxuoa5p730	微商	image_prompt	\N	\N	\N	产品展示-写实：手机俯拍视角，一双带淡色美甲的手正拧开一款蜂蜜柚子膏玻璃罐，罐口微微冒热气，桌面上有勺子、半切柚子和手写标签纸，自然日光从左上方洒入，生活感十足	\N	f	ai	t	2026-08-09 14:05:53.663	2026-08-09 14:05:53.663
cmslvl0g000e1i5cxpqkzgrk4	微商	image_prompt	\N	\N	\N	产品展示-国潮：青花瓷底纹圆形画幅中，五款草本膏方圆罐呈梅花状排列，罐身印烫金祥云与“本草有方”篆体字，背景虚化处隐约可见水墨山峦，红金配色喜庆又传统	\N	f	ai	t	2026-08-09 14:05:53.664	2026-08-09 14:05:53.664
cmslvl0g100e2i5cxz67j43y6	微商	image_prompt	\N	\N	\N	门店环境-ins风：阳光透过落地窗洒在原木货架上，三层架陈列着香薰蜡烛、手工皂和麻布袋装茶包，角落绿植垂坠，墙面挂一幅极简线描“慢生活”书法小匾，整体氛围松弛治愈	\N	f	ai	t	2026-08-09 14:05:53.665	2026-08-09 14:05:53.665
cmslvl0g200e3i5cxfio5z79e	微商	image_prompt	\N	\N	\N	门店环境-写实：傍晚时分街边小店实景，暖黄门头灯亮起，“芳邻手作”木质招牌清晰可见，玻璃门内透出暖光，门口停着一辆插满鲜花的自行车，路人模糊走过，真实烟火气	\N	f	ai	t	2026-08-09 14:05:53.666	2026-08-09 14:05:53.666
cmslvl0g300e4i5cxvglegs20	微商	image_prompt	\N	\N	\N	门店环境-国潮：朱红色仿古门框内景，青砖地面铺菱形拼花地毯，货架为榫卯结构深色榆木，陈列艾草香囊、扎染布包与铜铃许愿瓶，顶部悬垂红灯笼与书法卷轴“守拙·生香”，浓郁东方美学	\N	f	ai	t	2026-08-09 14:05:53.668	2026-08-09 14:05:53.668
cmslvl0g400e5i5cxydjntvsc	微商	image_prompt	\N	\N	\N	活动海报-ins风：“夏日轻养计划”主视觉，薄荷绿渐变底+白色手写字体，中央悬浮透明亚克力托盘盛放冷泡菊花枸杞茶、冰格柠檬片、竹制杯垫，留白充足，适合发圈配文案“这波清凉，我先替你试好了	\N	f	ai	t	2026-08-09 14:05:53.669	2026-08-09 14:05:53.669
cmslvl0g500e6i5cx3xfe6kow	微商	image_prompt	\N	\N	\N	活动海报-写实：社区团购群截图风格设计，手机界面显示“周三晚8点·李姐私房酵素限时开团！”弹窗+倒计时，背景是真实厨房台面（不锈钢水槽、蓝边抹布），右下角贴一张手写便利贴“前10名送试用装！	\N	f	ai	t	2026-08-09 14:05:53.67	2026-08-09 14:05:53.67
cmslvlie300f7i5cxjijvfrx6	直销	title	对比	对比	没有“躺赢”，但有可复制的动作清单：新人第1-30天每日任务表	\N	\N	f	ai	t	2026-08-09 14:06:16.923	2026-08-09 14:06:16.923
cmslvl0g600e7i5cxjgvbzd4r	微商	image_prompt	\N	\N	\N	活动海报-国潮：剪纸风边框环绕，中央大字“端午安康·艾意满满”，内嵌龙舟造型礼盒展开图（含艾草锤、香囊、五彩绳），底纹为暗金色云雷纹，配一句楷体短句“老祖宗的养生智慧，现在下单还送手写福卡	\N	f	ai	t	2026-08-09 14:05:53.671	2026-08-09 14:05:53.671
cmslvl0g700e8i5cxn78av6k8	微商	image_prompt	\N	\N	\N	客户案例-ins风：手机备忘录截图式构图，浅灰背景上显示一段真实聊天记录：“收到！昨天敷完脸软乎乎的～已推给闺女”，对话框旁贴一张模糊但温馨的自拍侧影（露出耳后细腻肌肤），配小字“第37位回购姐妹	\N	f	ai	t	2026-08-09 14:05:53.672	2026-08-09 14:05:53.672
cmslvl0g800e9i5cx8lnmevma	微商	image_prompt	\N	\N	\N	客户案例-写实：微信聊天页面特写，用户发来对比图九宫格——左图熬夜脸暗沉泛油，右图用完28天后T区透亮V脸明显，中间穿插一条语音气泡：“李姐，我妈也要囤！”画面右下角露出半截粉色指甲油和咖啡杯	\N	f	ai	t	2026-08-09 14:05:53.673	2026-08-09 14:05:53.673
cmslvl0g900eai5cxkee1cuck	微商	image_prompt	\N	\N	\N	客户案例-国潮：卷轴式竖版排版，左侧工笔画一位旗袍女士敷面膜微笑，右侧毛笔字书写客户手写反馈：“用三盒，姨妈准了，气色像二十出头”，落款盖一枚朱红“信”字印，底部缀流苏与艾草纹样	\N	f	ai	t	2026-08-09 14:05:53.674	2026-08-09 14:05:53.674
cmslvl0ga00ebi5cxdephsawc	微商	image_prompt	\N	\N	\N	氛围-ins风：午后阳台一角，藤编托盘盛着刚拆封的燕窝盏+银耳羹碗，背景虚化处有晾晒的棉麻内衣与一本翻开的《本草纲目》节选页，光影斑驳，安静温柔，传递“照顾好自己的日常仪式感	\N	f	ai	t	2026-08-09 14:05:53.675	2026-08-09 14:05:53.675
cmslvl0gc00eci5cxdp9rav0s	微商	image_prompt	\N	\N	\N	氛围-写实：凌晨1点台灯下伏案场景，电脑屏显示订单后台，手边保温杯冒着热气，便签纸上列着明日发货清单，镜子里映出疲惫却带笑的眼睛，桌上摆着客户送的苹果和手写贺卡“谢谢李姐一直靠谱	\N	f	ai	t	2026-08-09 14:05:53.676	2026-08-09 14:05:53.676
cmslvl0gd00edi5cxlx8ngqi2	微商	image_prompt	\N	\N	\N	氛围-国潮：水墨晕染背景中，一位盘发穿素色改良旗袍的女性背影立于窗前，窗外竹影摇曳，她手中捧一碗热腾腾的四物汤，蒸汽升腾幻化成“信”“诚”“暖”“久”四字篆印，整体静谧厚重	\N	f	ai	t	2026-08-09 14:05:53.678	2026-08-09 14:05:53.678
cmslvlid200eei5cxua1mz3vs	直销	title	数字	数字	3个被忽略的直销合规红线，90%新人第1周就踩坑	\N	\N	f	ai	t	2026-08-09 14:06:16.885	2026-08-09 14:06:16.885
cmslvlid500efi5cx3dzdqgp3	直销	title	反差	反差	从朝九晚五到每月多赚4700元，她只做对了这1件事	\N	\N	f	ai	t	2026-08-09 14:06:16.889	2026-08-09 14:06:16.889
cmslvlid700egi5cx16rblt22	直销	title	疑问	疑问	做直销=搞传销？”——市场监管总局2024年最新定性说明	\N	\N	f	ai	t	2026-08-09 14:06:16.891	2026-08-09 14:06:16.891
cmslvlid900ehi5cxndh1e1u9	直销	title	痛点	痛点	为什么有人干3个月放弃，而她用6个月建起稳定副业？	\N	\N	f	ai	t	2026-08-09 14:06:16.894	2026-08-09 14:06:16.894
cmslvlida00eii5cxcdhx8g6t	直销	title	福利	福利	这家公司连续8年通过商务部直销牌照年审，查证路径我放文末	\N	\N	f	ai	t	2026-08-09 14:06:16.895	2026-08-09 14:06:16.895
cmslvlidc00eji5cxg6ys0kr7	直销	title	权威数据	权威数据	副业月入过万？先看这5个真实收入结构图（非承诺）	\N	\N	f	ai	t	2026-08-09 14:06:16.896	2026-08-09 14:06:16.896
cmslvlidd00eki5cxtc0e1awq	直销	title	悬念	悬念	白天上班晚上带娃，她如何用2小时/天完成团队基础建设？	\N	\N	f	ai	t	2026-08-09 14:06:16.897	2026-08-09 14:06:16.897
cmslvlide00eli5cxlmci1e5w	直销	title	共情	共情	我老公说这是骗人的”——一位小学老师转型直销的真实日记	\N	\N	f	ai	t	2026-08-09 14:06:16.899	2026-08-09 14:06:16.899
cmslvlidf00emi5cxv7o0hbge	直销	title	故事	故事	零经验、没资源、不敢开口，30天新人成长路径全公开	\N	\N	f	ai	t	2026-08-09 14:06:16.9	2026-08-09 14:06:16.9
cmslvlidh00eni5cxyqxle60y	直销	title	清单	清单	为什么2024年超62万人选择合规直销作为轻创业入口？	\N	\N	f	ai	t	2026-08-09 14:06:16.901	2026-08-09 14:06:16.901
cmslvlidi00eoi5cxjm44o94m	直销	title	热点	热点	为什么同样做直销，有人3年还在学话术，有人已带出3个稳定小组？	\N	\N	f	ai	t	2026-08-09 14:06:16.902	2026-08-09 14:06:16.902
cmslvlidj00epi5cxyzjk9x4c	直销	title	对比	对比	别再问我怎么入行了”——一位90后宝妈的第100次坦白局	\N	\N	f	ai	t	2026-08-09 14:06:16.904	2026-08-09 14:06:16.904
cmslvlidk00eqi5cxfcq4z9cj	直销	title	对比	对比	公司提供全套线上培训+线下陪跑，但没人告诉你这3个关键动作	\N	\N	f	ai	t	2026-08-09 14:06:16.905	2026-08-09 14:06:16.905
cmslvlidl00eri5cxkbthz9rw	直销	title	对比	对比	她没发朋友圈、不拉亲戚，靠产品复购率自然组建起协作小组	\N	\N	f	ai	t	2026-08-09 14:06:16.906	2026-08-09 14:06:16.906
cmslvlidm00esi5cx66k3j6zw	直销	title	对比	对比	2024年行业调研：76%新人最希望被提前告知的5个运营真相	\N	\N	f	ai	t	2026-08-09 14:06:16.907	2026-08-09 14:06:16.907
cmslvlidn00eti5cxdlwb4827	直销	title	对比	对比	你敢信吗？这个岗位不需要KPI考核，但要求每日自我复盘	\N	\N	f	ai	t	2026-08-09 14:06:16.908	2026-08-09 14:06:16.908
cmslvlidp00eui5cxvfrc1c95	直销	title	对比	对比	我以为要天天推销”——入职第1周后她的认知刷新记录	\N	\N	f	ai	t	2026-08-09 14:06:16.909	2026-08-09 14:06:16.909
cmslvlidq00evi5cxkzck5i68	直销	title	对比	对比	为什么坚持做满90天的人，留存率比行业均值高3.2倍？	\N	\N	f	ai	t	2026-08-09 14:06:16.911	2026-08-09 14:06:16.911
cmslvlidr00ewi5cxwmdbtbqi	直销	title	对比	对比	她把直销当项目管理来运营：甘特图+客户分层+周复盘模板	\N	\N	f	ai	t	2026-08-09 14:06:16.912	2026-08-09 14:06:16.912
cmslvlids00exi5cxc11bht2f	直销	title	对比	对比	从被质疑到被咨询，她只改了3句话的沟通方式	\N	\N	f	ai	t	2026-08-09 14:06:16.913	2026-08-09 14:06:16.913
cmslvlidt00eyi5cxhc8u47lr	直销	title	对比	对比	直销到底能不能做？”——一位律师妈妈的30天合规实践笔记	\N	\N	f	ai	t	2026-08-09 14:06:16.914	2026-08-09 14:06:16.914
cmslvlidu00ezi5cxhc3esqj8	直销	title	对比	对比	为什么身边越来越多HR、幼师、社区工作者选择这个行业？	\N	\N	f	ai	t	2026-08-09 14:06:16.915	2026-08-09 14:06:16.915
cmslvlidv00f0i5cxpa51of5s	直销	title	对比	对比	我妈偷偷查了公司官网，然后给我转了2000元启动费	\N	\N	f	ai	t	2026-08-09 14:06:16.916	2026-08-09 14:06:16.916
cmslvlidw00f1i5cx5h8zqebw	直销	title	对比	对比	不是所有直销都一样：这张牌照对比表帮你避开灰色地带	\N	\N	f	ai	t	2026-08-09 14:06:16.917	2026-08-09 14:06:16.917
cmslvlidx00f2i5cx31nbkhb3	直销	title	对比	对比	她说“我不发展人，我只分享我用着好的东西”，结果呢？	\N	\N	f	ai	t	2026-08-09 14:06:16.918	2026-08-09 14:06:16.918
cmslvlidy00f3i5cxvmey9itm	直销	title	对比	对比	2024年最常被问的6个问题，我们请法务+运营双负责人逐条回应	\N	\N	f	ai	t	2026-08-09 14:06:16.919	2026-08-09 14:06:16.919
cmslvlie000f4i5cxg2s1i42r	直销	title	对比	对比	为什么这家公司的新人培训课，结业率高达89%？	\N	\N	f	ai	t	2026-08-09 14:06:16.92	2026-08-09 14:06:16.92
cmslvlie100f5i5cxfxluupit	直销	title	对比	对比	别急着交钱”——这是我给所有观望者的第1条建议	\N	\N	f	ai	t	2026-08-09 14:06:16.921	2026-08-09 14:06:16.921
cmslvlie200f6i5cxvwhd7um2	直销	title	对比	对比	她用Excel记录每天3个有效动作，30天后发现增长逻辑变了	\N	\N	f	ai	t	2026-08-09 14:06:16.922	2026-08-09 14:06:16.922
cmslvlie400f8i5cx978gipca	直销	title	对比	对比	这5个动作，决定了你前3个月是积累还是消耗	\N	\N	f	ai	t	2026-08-09 14:06:16.924	2026-08-09 14:06:16.924
cmslvlie400f9i5cx11drhkh2	直销	title	对比	对比	为什么95后更倾向选择“产品驱动型”直销而非传统模式？	\N	\N	f	ai	t	2026-08-09 14:06:16.925	2026-08-09 14:06:16.925
cmslvlie500fai5cxaxt5cj08	直销	title	对比	对比	她拒绝所有“快速起号”课程，坚持用官方素材做内容，结果如何？	\N	\N	f	ai	t	2026-08-09 14:06:16.926	2026-08-09 14:06:16.926
cmslvlie600fbi5cxgkqmnrwv	直销	title	对比	对比	3位不同职业背景的伙伴，分享他们选择这份事业的共同理由	\N	\N	f	ai	t	2026-08-09 14:06:16.927	2026-08-09 14:06:16.927
cmslvlie700fci5cxhij1dhqh	直销	title	对比	对比	不是选赛道，是选支持系统：我们的培训体系含哪4类实操工具？	\N	\N	f	ai	t	2026-08-09 14:06:16.928	2026-08-09 14:06:16.928
cmslvlie800fdi5cxtiqx2ehg	直销	title	对比	对比	听说你们要拉人头？”——我们用1张流程图讲清协作逻辑	\N	\N	f	ai	t	2026-08-09 14:06:16.929	2026-08-09 14:06:16.929
cmslvlie900fei5cxxxv0e3w3	直销	title	对比	对比	为什么今年高校就业报告把“合规直销运营岗”列入新兴轻职业？	\N	\N	f	ai	t	2026-08-09 14:06:16.93	2026-08-09 14:06:16.93
cmslvlieb00ffi5cxsgup0s8e	直销	title	对比	对比	她把第一次客户拜访录音转文字，找出3个可优化的真实细节	\N	\N	f	ai	t	2026-08-09 14:06:16.931	2026-08-09 14:06:16.931
cmslvliec00fgi5cxfm3ex9jh	直销	title	对比	对比	不画饼、不许诺，这份《新人30天成长手册》PDF可免费领取	\N	\N	f	ai	t	2026-08-09 14:06:16.932	2026-08-09 14:06:16.932
cmslvlied00fhi5cxi4jcrseg	直销	title	对比	对比	从被误解到被推荐，她只做了1件事：持续输出真实使用反馈	\N	\N	f	ai	t	2026-08-09 14:06:16.933	2026-08-09 14:06:16.933
cmslvlied00fii5cxhngfmc1t	直销	title	对比	对比	上海白领辞职做直销？真相是她同时保留社保并签了兼职协议	\N	\N	f	ai	t	2026-08-09 14:06:16.934	2026-08-09 14:06:16.934
cmslvliee00fji5cxcqddozhw	直销	title	对比	对比	我试用了半年才决定加入”——一位营养师的理性决策全过程	\N	\N	f	ai	t	2026-08-09 14:06:16.935	2026-08-09 14:06:16.935
cmslvlief00fki5cx6l8h56g2	直销	title	对比	对比	为什么公司禁止使用“团队裂变”“层级收益”等表述？法务解读	\N	\N	f	ai	t	2026-08-09 14:06:16.936	2026-08-09 14:06:16.936
cmslvlieg00fli5cx5e3lol7s	直销	title	对比	对比	她把产品知识做成小红书合集，3个月获自然咨询量超200+	\N	\N	f	ai	t	2026-08-09 14:06:16.937	2026-08-09 14:06:16.937
cmslvlieh00fmi5cx5mxf6wt8	直销	title	对比	对比	不是谁都能做，但适合这5类特质的人正在悄悄入场	\N	\N	f	ai	t	2026-08-09 14:06:16.938	2026-08-09 14:06:16.938
cmslvliei00fni5cxxpangevu	直销	title	对比	对比	别人说我是搞传销，我直接打开商务部官网给他看	\N	\N	f	ai	t	2026-08-09 14:06:16.939	2026-08-09 14:06:16.939
cmslvliej00foi5cxqybgkqpm	直销	title	对比	对比	为什么这家企业连续12年无行政处罚记录？数据来源附截图	\N	\N	f	ai	t	2026-08-09 14:06:16.939	2026-08-09 14:06:16.939
cmslvliek00fpi5cxcolqahra	直销	title	对比	对比	她没买流量、没投广告，靠10条产品体验视频建立初步信任	\N	\N	f	ai	t	2026-08-09 14:06:16.94	2026-08-09 14:06:16.94
cmslvliel00fqi5cxo01jqf9j	直销	title	对比	对比	30天后，她终于理解什么叫“用服务代替推销	\N	\N	f	ai	t	2026-08-09 14:06:16.941	2026-08-09 14:06:16.941
cmslvliem00fri5cxln1ds47x	直销	title	对比	对比	不是所有机会都值得投入时间，但这个支持系统经得起验证	\N	\N	f	ai	t	2026-08-09 14:06:16.942	2026-08-09 14:06:16.942
cmslvlien00fsi5cxmqzzpgof	直销	title	对比	对比	2024新规下，哪些行为会被认定为违规？这4条红线必须知道	\N	\N	f	ai	t	2026-08-09 14:06:16.943	2026-08-09 14:06:16.943
cmslvlieo00fti5cx08gc2wcf	直销	title	对比	对比	我婆婆现在自己下单，还帮我介绍邻居试用	\N	\N	f	ai	t	2026-08-09 14:06:16.944	2026-08-09 14:06:16.944
cmslvliep00fui5cx7oro369b	直销	title	对比	对比	她把每日学习笔记整理成共享文档，小组自发形成互助机制	\N	\N	f	ai	t	2026-08-09 14:06:16.945	2026-08-09 14:06:16.945
cmslvlier00fvi5cxyb9u2cyu	直销	title	对比	对比	为什么我们要求新人首月必完成3次非销售型互动？	\N	\N	f	ai	t	2026-08-09 14:06:16.947	2026-08-09 14:06:16.947
cmslvlies00fwi5cxumhspolh	直销	title	对比	对比	没有“轻松月入X万”，但有清晰的阶段性能力成长刻度表	\N	\N	f	ai	t	2026-08-09 14:06:16.949	2026-08-09 14:06:16.949
cmslvliet00fxi5cxm7j6e9l6	直销	title	对比	对比	她曾因家人反对暂停2周，后来用一份《家庭沟通指南》重启	\N	\N	f	ai	t	2026-08-09 14:06:16.95	2026-08-09 14:06:16.95
cmslvlieu00fyi5cxopyc6rjw	直销	title	对比	对比	不是招代理，是找同行者”——这是我们写在招募页的第一句话	\N	\N	f	ai	t	2026-08-09 14:06:16.951	2026-08-09 14:06:16.951
cmslvliew00fzi5cxnoa5tqhl	直销	title	对比	对比	为什么公司所有培训材料都标注“依据《直销管理条例》第X条”？	\N	\N	f	ai	t	2026-08-09 14:06:16.952	2026-08-09 14:06:16.952
cmslvliex00g0i5cxzk3tyn9j	直销	title	对比	对比	她把客户反馈分类归档，意外发现3个高频需求点	\N	\N	f	ai	t	2026-08-09 14:06:16.953	2026-08-09 14:06:16.953
cmslvliey00g1i5cxouxlot8u	直销	title	对比	对比	不是靠激情入场，而是用PDCA循环打磨每一个服务动作	\N	\N	f	ai	t	2026-08-09 14:06:16.954	2026-08-09 14:06:16.954
cmslvml2j00g2i5cxuulgob2i	直销	article	新客引流	\N	\N	新客引流：我们不做“拉人头”，只做“帮人找路”。如果你正寻找一份时间灵活、投入可控的轻创业机会，欢迎了解我们专注健康生活方式12年的品牌。所有产品经国家备案，事业支持体系透明可查，无囤货压力、无加盟费。已有372位伙伴从零开始，用业余时间建立属于自己的健康事业。扫码预约一对一职业适配咨询，不推销、不施压，只帮你判断是否适合。	\N	f	ai	t	2026-08-09 14:07:07.05	2026-08-09 14:07:07.05
cmslvml2l00g3i5cxv8k7ihgr	直销	article	老客复购	\N	\N	新客引流：不是所有副业都值得投入时间。我们提供一份《轻创业可行性自测表》（含时间/技能/资源三维度），帮你理性评估是否适合健康行业从业。无需经验，但需认同“先服务、后成长”理念。所有学习资料免费开放，事业路径图清晰可见——从产品学习到客户陪伴，全程有导师带教。点击领取测评，3分钟看清自己与这份事业的匹配度。	\N	f	ai	t	2026-08-09 14:07:07.054	2026-08-09 14:07:07.054
cmslvml2n00g4i5cxpwcyosdw	直销	article	产品种草	\N	\N	新客引流：你刷到这条，大概率正在对比各种副业方案。我们不承诺收益，但公开事业支持细节：每月4场线上共学、1对1成长计划模板、合规展业工具包（含话术指南/内容素材库/客户管理表）。所有伙伴均签署《展业自律公约》，拒绝夸大宣传。如果你看重真实、长期、有温度的成长，欢迎加入我们的观察期社群，先看、再试、后决定。	\N	f	ai	t	2026-08-09 14:07:07.056	2026-08-09 14:07:07.056
cmslvml2p00g5i5cxv8gwbulr	直销	article	客户见证	\N	\N	老客复购：上次购买【益生菌粉】的您，可能注意到瓶身新增了“活性菌株溯源码”——我们联合中科院微生物所升级了6大检测环节，每批次报告公开可查。复购即享专属健康档案服务：由持证营养师为您解读3个月使用反馈，并优化搭配建议。这不是促销，而是我们对老用户持续负责的方式。点击进入您的专属服务页，查看定制化复购方案。	\N	f	ai	t	2026-08-09 14:07:07.058	2026-08-09 14:07:07.058
cmslvml2r00g6i5cxz7c3rmsd	直销	article	节假日活动	\N	\N	老客复购：您已连续12个月选择我们的植物蛋白粉，感谢这份信任。为回馈长期用户，我们启动“健康习惯养成计划”：第13次复购起，每单自动累积“健康积分”，可兑换家庭体检套餐、营养师1v1咨询或公益捐赠署名权。所有权益不设有效期，不绑定续费率。您的坚持，值得被郑重记录。	\N	f	ai	t	2026-08-09 14:07:07.06	2026-08-09 14:07:07.06
cmslvml2u00g7i5cx9bdadusr	直销	article	品牌故事	\N	\N	老客复购：很多老用户问：“用了两年，还能怎么优化？”我们邀请您参与「老用户深度共创」：提交您真实的使用场景（如哺乳期调理/加班代餐/术后恢复），我们将联合研发团队定向优化配方，并在新品上市前优先寄送测试装。您的经验，是产品迭代最珍贵的依据。点击填写1分钟问卷，即刻加入共创者名录。	\N	f	ai	t	2026-08-09 14:07:07.062	2026-08-09 14:07:07.062
cmslvml2w00g8i5cx73u05hbz	直销	article	上新公告	\N	\N	产品种草：这款【接骨木莓复合饮】没有“提高免疫力”的宣称，但它的核心原料来自德国有机农场，每批次花青素含量经SGS检测≥850mg/100g。我们更关注它如何融入真实生活：晨间替代含糖果汁、会议间隙提神不刺激、孩子挑食时混入酸奶。附赠《四季食用指南》电子册——不讲功效，只说场景、剂量与搭配逻辑。真实，从拒绝话术开始。	\N	f	ai	t	2026-08-09 14:07:07.064	2026-08-09 14:07:07.064
cmslvml2y00g9i5cxorxjndyu	直销	article	优惠活动	\N	\N	产品种草：为什么这款【冷萃咖啡因精华】上线3个月复购率达68%？用户反馈集中在三点：0添加蔗糖、小支装方便携带、下午3点后服用不影响睡眠（经人体代谢追踪验证）。我们没把它包装成“能量神器”，而是做成办公族的“清醒守门员”——帮你守住专注力底线，而非透支身体。详情页附全部检测报告与代谢曲线图，欢迎查验。	\N	f	ai	t	2026-08-09 14:07:07.066	2026-08-09 14:07:07.066
cmslvml2z00gai5cxcw90q4li	直销	article	知识科普	\N	\N	产品种草：看到“胶原蛋白”就警惕？我们理解。这款【海洋鱼胶原三肽】主打“小分子+维生素C协同吸收”，分子量≤500Da，经体外模拟胃肠道实验验证吸收率提升42%。包装内附《成分溯源卡》，扫码可见原料捕捞海域、精制工厂、检测机构全流程。种草不靠故事，靠可验证的数据链和坦诚的局限说明（如：需连续服用8周以上观察皮肤变化）。	\N	f	ai	t	2026-08-09 14:07:07.068	2026-08-09 14:07:07.068
cmslvml3100gbi5cx5vy0uk45	直销	article	互动话题	\N	\N	客户见证：李婷，32岁，成都小学教师。入职前担心“被当推销员”，先用半年时间自学营养知识、跟听12场公开课，再以“健康分享者”身份自然推荐。现在她每月用15小时维护客户关系，收入覆盖女儿兴趣班费用。她说：“最骄傲的不是数字，是家长主动问我‘孩子挑食怎么办’——我终于能用专业帮到人。	\N	f	ai	t	2026-08-09 14:07:07.069	2026-08-09 14:07:07.069
cmslvml3200gci5cxem4gn6ee	直销	article	答疑辟谣	\N	\N	客户见证：陈磊，41岁，前IT项目经理。转型初期被家人质疑“是不是搞传销”，他带着父母一起参加公司开放日，现场查阅营业执照、直销许可证及全部备案产品目录。如今他组建的学习小组里，70%成员是医生、教师、公务员。“信任不是说服来的，是陪他们亲眼看见规则、流程和底线。	\N	f	ai	t	2026-08-09 14:07:07.07	2026-08-09 14:07:07.07
cmslvml3500gdi5cx1v3dc1hk	直销	article	会员权益	\N	\N	客户见证：林薇，28岁，产后抑郁康复期加入。她没追求业绩，专注整理《新手妈妈营养笔记》，免费分享给社区群。意外收到37位妈妈私信求助，由此开启“母婴营养陪伴”小课。公司为她提供合规内容审核与线上课堂技术支持。她说：“当我停止想‘卖什么’，开始思考‘帮什么’，路反而清晰了。	\N	f	ai	t	2026-08-09 14:07:07.073	2026-08-09 14:07:07.073
cmslvml3a00gei5cxma3jb1pa	直销	article	会员权益	\N	\N	节假日活动：中秋不推“团圆礼盒”，而发起「家的味道·健康手作计划」：下单即赠《低糖月饼DIY手册》+天然甜味剂套装，邀请您和家人一起动手制作。所有食材标注农残检测编号，视频教程由食品工程师出镜讲解原理。订单满299元，我们以您名义向乡村小学捐赠1份营养午餐。节日的意义，在于共同创造真实价值。	\N	f	ai	t	2026-08-09 14:07:07.078	2026-08-09 14:07:07.078
cmslvml3b00gfi5cxo9ce5ngj	直销	article	会员权益	\N	\N	节假日活动：国庆长假将至，我们暂停所有促销推送，改为上线《假期健康自检清单》：含作息调整建议、旅行便携营养包搭配、儿童出行防护提醒。完成清单打卡可解锁“健康守护者”电子徽章（非实物、无门槛）。真正的节日关怀，是尊重您的节奏，而非制造消费焦虑。	\N	f	ai	t	2026-08-09 14:07:07.08	2026-08-09 14:07:07.08
cmslvml3c00ggi5cxsttspzw0	直销	article	会员权益	\N	\N	节假日活动：春节临近，很多伙伴问“怎么跟家人解释这份事业”。我们制作了《家人沟通参考话术包》：含“直销vs传销”核心区别图解、公司合规资质一键查询入口、常见质疑应答逻辑树。不教您说服，只帮您厘清事实。下载即用，也欢迎您把链接发给关心您的亲人——透明，是最好的沟通桥梁。	\N	f	ai	t	2026-08-09 14:07:07.081	2026-08-09 14:07:07.081
cmslvml3e00ghi5cxmrigfd3i	直销	article	会员权益	\N	\N	品牌故事：2011年，创始人张明在云南调研时发现：好山药因缺乏稳定销路烂在地里，而城市家庭却买不到真正无硫熏的山药粉。他放弃外企高管职位，带着食品工程团队扎根产地，建起第一条GMP级山药低温干燥线。13年来，我们拒绝OEM贴牌，所有核心产品自主生产，许可证号、工厂实景、质检报告全部官网公示。初心未变：让好原料，以本来的样子抵达需要的人。	\N	f	ai	t	2026-08-09 14:07:07.082	2026-08-09 14:07:07.082
cmslvml3f00gii5cxt1fkobp6	直销	article	会员权益	\N	\N	品牌故事：没有传奇开局，只有笨功夫。我们连续8年坚持“三不原则”：不采购无法溯源的原料、不委托无现场审核的代工厂、不宣传未经文献支持的功效词。2023年主动下架2款高复购但临床数据不足的产品，尽管损失季度营收超千万。信任不是靠话术堆砌，是靠一次次选择难而正确的路。	\N	f	ai	t	2026-08-09 14:07:07.083	2026-08-09 14:07:07.083
cmslvml3g00gji5cx5f76w9c0	直销	article	会员权益	\N	\N	品牌故事：一位老客户曾留言：“你们官网上连客服电话都写了3个分机号，怕我们打不通。”这让我们反思：所谓专业，不是话术多漂亮，而是把每个服务触点做得足够实在。现在，官网首页滚动展示当日质检进度、物流签收率、客诉48小时响应率。品牌不是讲出来的，是在无数个“应该做到”的细节里长出来的。	\N	f	ai	t	2026-08-09 14:07:07.084	2026-08-09 14:07:07.084
cmslvml3h00gki5cx6rzifmz5	直销	article	会员权益	\N	\N	上新公告：【全食物酵素软糖】今日正式备案上市。它不是“减肥糖果”，而是针对久坐人群设计的餐后辅助方案：含5种果蔬发酵产物+消化酶复合配方，每日2粒，随餐嚼食。备案凭证号可在国家市场监督管理总局官网查询（编号：JZ2024XXXXXX）。首批发货附赠《酵素科学认知手册》，破除“酵素万能论”，讲清适用场景与局限性。	\N	f	ai	t	2026-08-09 14:07:07.085	2026-08-09 14:07:07.085
cmslvml3h00gli5cxdvy8k9k3	直销	article	会员权益	\N	\N	上新公告：全新【缓释型镁B6片】通过保健食品注册（国食健注G2024XXXXXX），采用双层包衣技术，实现胃部不释放、肠道缓释吸收。我们同步公开了稳定性试验报告（加速试验6个月）、原料供应商审计记录、以及与三甲医院合作的耐受性观察数据（n=127）。新品不讲“补得快”，只说“释得稳、耐受好”。	\N	f	ai	t	2026-08-09 14:07:07.086	2026-08-09 14:07:07.086
cmslvml3i00gmi5cxl841s2nf	直销	article	会员权益	\N	\N	上新公告：【舒缓助眠茶】升级为“可溯源茶包”：每盒印有茶园GPS坐标、采摘日期、初制师傅姓名及编号。我们取消香精增香，改用低温冻干洋甘菊+关苍术挥发油微囊技术，保留植物本味的同时提升稳定性。包装内附《助眠茶科学饮用指南》，明确提示“不替代药物”“孕妇慎用”“连续饮用不超过4周”等关键信息。	\N	f	ai	t	2026-08-09 14:07:07.087	2026-08-09 14:07:07.087
cmslvml3j00gni5cxxns0ll23	直销	article	会员权益	\N	\N	优惠活动：本次“健康启程月”不设满减陷阱，实行阶梯式学习激励：完成产品知识测试（80分以上），赠《家庭健康自查手册》；参与2场直播共学，解锁营养师1v1答疑券；组建3人学习小组并提交实践记录，获赠定制版健康日志本。所有奖励聚焦能力成长，而非单纯消费刺激。	\N	f	ai	t	2026-08-09 14:07:07.088	2026-08-09 14:07:07.088
cmslvml3k00goi5cxto3z0eq4	直销	article	会员权益	\N	\N	优惠活动：拒绝“限时抢购”压迫感。本次福利周期为30天，期间下单即享：① 产品说明书升级为AR交互版（手机扫码看原料生长实景）② 免费生成个人版《营养摄入分析简报》③ 加入“健康践行者”月度分享会（仅限当月新伙伴）。福利不捆绑、不倒计时、不制造稀缺幻觉。	\N	f	ai	t	2026-08-09 14:07:07.089	2026-08-09 14:07:07.089
cmslvml3m00gpi5cx2wwfyrwn	直销	article	会员权益	\N	\N	优惠活动：我们把“优惠”定义为“降低尝试门槛”。新伙伴首单可选：① 0元领取《健康基础工具包》（含体脂率测算尺、饮水打卡卡、3日饮食记录表）② 支付9.9元得入门套装（含3款明星产品体验装+使用指导音频）③ 免费预约职业适配面谈（45分钟，含SWOT简析）。选择权，永远在您手中。	\N	f	ai	t	2026-08-09 14:07:07.09	2026-08-09 14:07:07.09
cmslvml3n00gqi5cx87qpqwez	直销	article	会员权益	\N	\N	知识科普：很多人问“益生菌要冷藏吗？”答案取决于菌株特性与包埋工艺。我们这款采用双层微囊技术，常温可保存18个月（检测报告见详情页）。但请记住：益生菌不是“万能菌”，它无法替代膳食纤维摄入，也不能解决所有肠道问题。真正有效的肠道健康方案=优质菌株+足量膳食纤维+规律作息。科普不为卖货，只为让您知情决策。	\N	f	ai	t	2026-08-09 14:07:07.092	2026-08-09 14:07:07.092
cmslvml3o00gri5cx0vnolt8e	直销	article	会员权益	\N	\N	知识科普：“胶原蛋白吃进去就变成氨基酸？”对。但它能否重组为皮肤胶原，取决于个体代谢状态、维生素C摄入量及紫外线防护水平。我们不宣称“吃了变嫩”，但提供经临床验证的三肽配方+协同营养素组合，并附《影响胶原合成的5个关键变量》自查	\N	f	ai	t	2026-08-09 14:07:07.093	2026-08-09 14:07:07.093
cmslvmv5e00gsi5cxs0y74jq8	直销	topic	\N	\N	春招季来临，25-45岁职场人如何用30天验证一份“时间可自主、收入可预期”的轻事业？	\N	\N	f	ai	t	2026-08-09 14:07:20.115	2026-08-09 14:07:20.115
cmslvmv5g00gti5cxs0jznk9g	直销	topic	\N	\N	清明返乡见闻：在县城做健康服务的表姐，为什么连续三年没换工作？	\N	\N	f	ai	t	2026-08-09 14:07:20.117	2026-08-09 14:07:20.117
cmslvmv5h00gui5cx50szi5ki	直销	topic	\N	\N	五一假期后，我辞掉了朝九晚五，开始用业余时间经营自己的健康生活事业	\N	\N	f	ai	t	2026-08-09 14:07:20.118	2026-08-09 14:07:20.118
cmslvmv5i00gvi5cxsknbuhnd	直销	topic	\N	\N	母亲节前夕，一位全职妈妈的真实记录：从被质疑到社区健康分享会常驻主讲人	\N	\N	f	ai	t	2026-08-09 14:07:20.119	2026-08-09 14:07:20.119
cmslvmv5k00gwi5cx8m78yqzu	直销	topic	\N	\N	高考志愿填报季：孩子选专业，我选了一条不靠学历、靠持续学习的成长路径	\N	\N	f	ai	t	2026-08-09 14:07:20.12	2026-08-09 14:07:20.12
cmslvmv5l00gxi5cxivevvj70	直销	topic	\N	\N	618不只囤货，我在直播间学到了“如何把日常分享变成可持续行动	\N	\N	f	ai	t	2026-08-09 14:07:20.121	2026-08-09 14:07:20.121
cmslvmv5m00gyi5cxlf7h5x5a	直销	topic	\N	\N	梅雨季湿气重？本地团队发起的21天体质调理陪伴计划正在招募体验伙伴	\N	\N	f	ai	t	2026-08-09 14:07:20.122	2026-08-09 14:07:20.122
cmslvmv5n00gzi5cxon42oql4	直销	topic	\N	\N	暑假开始前，一位小学老师分享：如何利用假期系统学习营养与健康知识	\N	\N	f	ai	t	2026-08-09 14:07:20.123	2026-08-09 14:07:20.123
cmslvmv5o00h0i5cxhc2lruqf	直销	topic	\N	\N	七夕不只送礼，我们和10对夫妻一起完成了“家庭健康目标共建”实践	\N	\N	f	ai	t	2026-08-09 14:07:20.124	2026-08-09 14:07:20.124
cmslvmv5p00h1i5cx16pctuoq	直销	topic	\N	\N	立秋养生热兴起，为什么越来越多普通人选择成为“身边人的健康信息筛选者”？	\N	\N	f	ai	t	2026-08-09 14:07:20.125	2026-08-09 14:07:20.125
cmslvmv5q00h2i5cxnoxtoec8	直销	topic	\N	\N	教师节特别记录：三位一线教师的副业转型实录——从教案设计到社群健康陪伴	\N	\N	f	ai	t	2026-08-09 14:07:20.126	2026-08-09 14:07:20.126
cmslvmv5q00h3i5cxypeqj90r	直销	topic	\N	\N	中秋家宴变健康沙龙：今年我家饭桌多了份《家庭膳食自测指南》和真实使用反馈	\N	\N	f	ai	t	2026-08-09 14:07:20.127	2026-08-09 14:07:20.127
cmslvmv5r00h4i5cx6a7wb10u	直销	topic	\N	\N	国庆长假归来，我整理了过去12个月的事业成长时间轴（含学习/服务/复盘）	\N	\N	f	ai	t	2026-08-09 14:07:20.128	2026-08-09 14:07:20.128
cmslvmv5s00h5i5cx8hajzp2l	直销	topic	\N	\N	寒露过后呼吸道敏感高发，社区健康支持小组启动“邻里互助提醒计划	\N	\N	f	ai	t	2026-08-09 14:07:20.128	2026-08-09 14:07:20.128
cmslvmv5t00h6i5cxlkzvwcdk	直销	topic	\N	\N	双11理性消费潮下，我们发起“健康消费决策力提升21天训练	\N	\N	f	ai	t	2026-08-09 14:07:20.129	2026-08-09 14:07:20.129
cmslvmv5t00h7i5cx37y32drw	直销	topic	\N	\N	小雪节气前后，北方团队开展“冬季居家健康习惯打卡”公益陪伴行动	\N	\N	f	ai	t	2026-08-09 14:07:20.13	2026-08-09 14:07:20.13
cmslvmv5u00h8i5cxzmdqizcw	直销	topic	\N	\N	冬至汤圆煮好时，听一位95后分享：她如何用半年建立属于自己的服务节奏	\N	\N	f	ai	t	2026-08-09 14:07:20.131	2026-08-09 14:07:20.131
cmslvmv5v00h9i5cxcv7zglq8	直销	topic	\N	\N	元旦新启，不做年度豪言，只公开一份《2025个人成长承诺书》模板	\N	\N	f	ai	t	2026-08-09 14:07:20.131	2026-08-09 14:07:20.131
cmslvmv5w00hai5cxdjdmvlxg	直销	topic	\N	\N	春节返乡观察：村里开小卖部的叔叔回头做起了健康产品知识讲解员	\N	\N	f	ai	t	2026-08-09 14:07:20.132	2026-08-09 14:07:20.132
cmslvmv5w00hbi5cxjb9q6ahz	直销	topic	\N	\N	元宵节灯会现场，我们设置了“健康生活问答转盘”，答案来自真实用户反馈	\N	\N	f	ai	t	2026-08-09 14:07:20.133	2026-08-09 14:07:20.133
cmslvmv5x00hci5cxi0lh07ub	直销	topic	\N	\N	情人节不谈爱情谈关系：健康事业里，我学会的第一课是“真诚比话术重要	\N	\N	f	ai	t	2026-08-09 14:07:20.134	2026-08-09 14:07:20.134
cmslvmv5z00hdi5cxr8cm6wng	直销	topic	\N	\N	惊蛰春雷响，团队启动“百人健康习惯重启计划”，全程透明公示进展	\N	\N	f	ai	t	2026-08-09 14:07:20.135	2026-08-09 14:07:20.135
cmslvmv6000hei5cxydbw60my	直销	topic	\N	\N	3·15消费者权益日，我们发布《健康服务提供者自律公约》及执行记录	\N	\N	f	ai	t	2026-08-09 14:07:20.136	2026-08-09 14:07:20.136
cmslvmv6100hfi5cxiqqax9f5	直销	topic	\N	\N	春分昼夜平，邀请你参与一场“2小时线下体验：了解健康生活方式支持者日常	\N	\N	f	ai	t	2026-08-09 14:07:20.138	2026-08-09 14:07:20.138
cmslvmv6200hgi5cxfcutniu4	直销	topic	\N	\N	世界睡眠日，本地伙伴发起“城市轻压力生活实验”，开放围观全过程	\N	\N	f	ai	t	2026-08-09 14:07:20.139	2026-08-09 14:07:20.139
cmslvmv6300hhi5cxoj9th416	直销	topic	\N	\N	清明踏青季，户外健康轻徒步活动报名开启（非销售，纯体验共建）	\N	\N	f	ai	t	2026-08-09 14:07:20.14	2026-08-09 14:07:20.14
cmslvmv6400hii5cx6jbu4gcj	直销	topic	\N	\N	谷雨时节，团队整理发布《普通人也能看懂的营养补充常识手册》（免费申领）	\N	\N	f	ai	t	2026-08-09 14:07:20.141	2026-08-09 14:07:20.141
cmslvmv6500hji5cxd55enxsw	直销	topic	\N	\N	五一劳动节致敬劳动者：听一位快递站长讲述他如何兼顾派件与健康知识学习	\N	\N	f	ai	t	2026-08-09 14:07:20.141	2026-08-09 14:07:20.141
cmslvmv6600hki5cxe0l1tgmw	直销	topic	\N	\N	国际家庭日，我们收集了37个真实家庭的“小改变大不同”健康实践片段	\N	\N	f	ai	t	2026-08-09 14:07:20.142	2026-08-09 14:07:20.142
cmslvmv6700hli5cx4eyd6qhi	直销	topic	\N	\N	全国爱眼日，联合视光师开展“屏幕族护眼习惯养成”公益轻陪伴计划	\N	\N	f	ai	t	2026-08-09 14:07:20.143	2026-08-09 14:07:20.143
cmslvn6wc00hmi5cxjipaghlh	直销	image_prompt	\N	\N	\N	产品展示-ins风：极简白色背景，天然植物提取的护肤精华瓶居中，柔光漫射，瓶身水珠晶莹，旁边散落几片新鲜洋甘菊与亚麻布纹理，干净清新，浅焦虚化，Instagram质感	\N	f	ai	t	2026-08-09 14:07:35.34	2026-08-09 14:07:35.34
cmslvn6wf00hni5cxgc2hc2xr	直销	image_prompt	\N	\N	\N	产品展示-写实：阳光透过窗户洒在实木台面上，一排已开封的营养补充剂礼盒整齐陈列，标签清晰可见成分说明，手部特写正拿起一粒胶囊，自然肤色与指甲细节真实，生活化厨房场景	\N	f	ai	t	2026-08-09 14:07:35.343	2026-08-09 14:07:35.343
cmslvn6wg00hoi5cxese1774o	直销	image_prompt	\N	\N	\N	产品展示-国潮：青花瓷纹样底框内，传统草本造型的膏方罐与现代滴管瓶并置，罐身烫金“本草新用”字样，背景晕染水墨山峦，红金丝带缠绕瓶身，兼具文化底蕴与年轻活力	\N	f	ai	t	2026-08-09 14:07:35.345	2026-08-09 14:07:35.345
cmslvn6wh00hpi5cxtud36aw2	直销	image_prompt	\N	\N	\N	门店环境-ins风：原木色货架与绿植墙交映，玻璃门透出柔和天光，店员穿米白制服微笑整理天然香氛摆件，角落咖啡角冒着热气，整体明亮松弛，莫兰迪色调	\N	f	ai	t	2026-08-09 14:07:35.346	2026-08-09 14:07:35.346
cmslvn6wj00hqi5cx0izxjt5h	直销	image_prompt	\N	\N	\N	门店环境-写实：社区临街小店实拍视角，招牌清晰可见品牌LOGO与“健康生活体验中心”字样，门口有顾客驻足咨询，店内三位不同年龄顾客正在试用体脂仪，收银台旁摆放当日手写服务时间牌	\N	f	ai	t	2026-08-09 14:07:35.347	2026-08-09 14:07:35.347
cmslvn6wk00hri5cx2vd3qyru	直销	image_prompt	\N	\N	\N	门店环境-国潮：朱红门楣配铜环，门头悬挂篆书灯箱“养正堂”，室内竹编屏风隔断，展架上产品包装融合祥云纹与二维码标识，一位穿改良旗袍的店主正为老人演示按摩仪，暖光灯笼点缀天花	\N	f	ai	t	2026-08-09 14:07:35.348	2026-08-09 14:07:35.348
cmslvn6wl00hsi5cx9lkq2pgc	直销	image_prompt	\N	\N	\N	活动海报-ins风：低饱和粉蓝渐变背景，手绘风格插画人物围坐圆桌分享笔记本与茶杯，中央悬浮发光文字“30天轻创业陪伴计划”，留白充足，字体圆润现代，适合小红书封面	\N	f	ai	t	2026-08-09 14:07:35.349	2026-08-09 14:07:35.349
cmslvn6wm00hti5cx5qoetwim	直销	image_prompt	\N	\N	\N	活动海报-写实：真实招商会现场俯拍，长条会议桌铺浅灰桌布，每人面前有姓名牌、资料册与笔记本，主讲人站在投影幕布前指向“事业支持体系”图表，幕布内容清晰可辨，无模糊处理	\N	f	ai	t	2026-08-09 14:07:35.35	2026-08-09 14:07:35.35
cmslvn6wn00hui5cxfxudc57t	直销	image_prompt	\N	\N	\N	活动海报-国潮：敦煌飞天飘带环绕构图，中央烫金大字“启程·她力量成长营”，下方分三栏呈现“学—练—陪”图标，配青绿山水小景与现代女性剪影，边框采用活字印刷纹理	\N	f	ai	t	2026-08-09 14:07:35.351	2026-08-09 14:07:35.351
cmslvn6wo00hvi5cxp55db0ez	直销	image_prompt	\N	\N	\N	客户案例-ins风：28岁女性侧脸微笑坐在阳台藤椅上，膝上放打开的事业手册与平板电脑显示学习页面，背景虚化中可见窗台绿植与日历标记“第17天”，光影温柔，胶片滤镜感	\N	f	ai	t	2026-08-09 14:07:35.352	2026-08-09 14:07:35.352
cmslvn6wo00hwi5cxnlr8w6rn	直销	image_prompt	\N	\N	\N	客户案例-写实：三口之家在客厅使用空气净化仪，孩子指着实时PM2.5数值屏，父亲调试设备，母亲手持检测报告微笑讲解，电视柜上摆放品牌授权证书与用户服务卡，真实家居环境	\N	f	ai	t	2026-08-09 14:07:35.353	2026-08-09 14:07:35.353
cmslvn6wp00hxi5cxryqbmja0	直销	image_prompt	\N	\N	\N	客户案例-国潮：水墨晕染背景中，四位不同职业女性剪影并列（教师/护士/设计师/全职妈妈），每人手中持一枚刻有“践行者”印章的木质书签，下方毛笔字题“真实生长，自有回响”，印章朱砂鲜亮	\N	f	ai	t	2026-08-09 14:07:35.354	2026-08-09 14:07:35.354
cmslvn6wq00hyi5cx7aygwoe5	直销	image_prompt	\N	\N	\N	氛围-ins风：黄昏时分咖啡馆角落，五位年轻人围坐分享手机屏幕上的学习进度，桌上摊开笔记本与便签纸，杯沿印着淡淡唇色，柔焦突出笑容与眼神交流，温暖治愈系	\N	f	ai	t	2026-08-09 14:07:35.354	2026-08-09 14:07:35.354
cmslvn6wr00hzi5cx3e4i618i	直销	image_prompt	\N	\N	\N	氛围-写实：周末线下沙龙实录，圆形木桌旁七人专注参与互动游戏，有人举手发言，有人记录笔记，白板写满关键词如“时间管理”“客户沟通”，窗外可见城市绿荫，无摆拍痕迹	\N	f	ai	t	2026-08-09 14:07:35.355	2026-08-09 14:07:35.355
cmslvn6wr00i0i5cx9q86518o	直销	image_prompt	\N	\N	\N	氛围-国潮：灯笼光影下庭院聚会场景，竹椅围合，中间陶炉煮茶，参与者手捧印有节气图案的定制杯，一人展开手绘版《30天行动地图》，背景墙挂“同心同行”书法卷轴，烟火气与仪式感并存	\N	f	ai	t	2026-08-09 14:07:35.356	2026-08-09 14:07:35.356
cmslw2nqr0000i5pyqk3px6mx	健身	title	数字	数字	3个月甩掉28斤，她没节食没狂练，只做对了这1件事	\N	\N	f	ai	t	2026-08-09 14:19:37.01	2026-08-09 14:19:37.01
cmslw2nqu0001i5py2ebl4vpc	健身	title	反差	反差	从“健身房恐惧症”到月均打卡26天，她的转变藏在这张课表里	\N	\N	f	ai	t	2026-08-09 14:19:37.015	2026-08-09 14:19:37.015
cmslw2nqw0002i5pyhc32scnh	健身	title	疑问	疑问	产后腰腹赘肉顽固？90%的人漏掉了骨盆矫正这个关键步骤	\N	\N	f	ai	t	2026-08-09 14:19:37.016	2026-08-09 14:19:37.016
cmslw2nqx0003i5py0z454k9p	健身	title	痛点	痛点	练了半年没变化”？你可能一直在用错误的呼吸方式发力	\N	\N	f	ai	t	2026-08-09 14:19:37.017	2026-08-09 14:19:37.017
cmslw2nqy0004i5py5vzta2qp	健身	title	福利	福利	免费体验课限前30名｜私教1v1体态评估+定制计划（含饮食建议）	\N	\N	f	ai	t	2026-08-09 14:19:37.018	2026-08-09 14:19:37.018
cmslw2nqz0005i5pyg29gblc8	健身	title	权威数据	权威数据	全国超73%的久坐族存在肩颈代偿，你的圆肩驼背正在悄悄加速衰老	\N	\N	f	ai	t	2026-08-09 14:19:37.019	2026-08-09 14:19:37.019
cmslw2nqz0006i5pyvci8g41b	健身	title	悬念	悬念	她第4次办卡失败后，在这里坚持满1年——教练说她进步速度超预期2.3倍	\N	\N	f	ai	t	2026-08-09 14:19:37.02	2026-08-09 14:19:37.02
cmslw2nr00007i5pyqm6hx1v1	健身	title	共情	共情	又胖了”不是你的错，是代谢率下降+肌肉流失在联手偷走你的线条	\N	\N	f	ai	t	2026-08-09 14:19:37.021	2026-08-09 14:19:37.021
cmslw2nr10008i5pyye5wycm9	健身	title	故事	故事	王姐的故事：42岁确诊轻度骨质疏松，3个月体脂降5.2%，骨密度回升0.8%	\N	\N	f	ai	t	2026-08-09 14:19:37.022	2026-08-09 14:19:37.022
cmslw2nr20009i5pyxy6hcgtf	健身	title	清单	清单	新手必看｜私教课前必须问清的5个问题，避开隐形消费和无效训练	\N	\N	f	ai	t	2026-08-09 14:19:37.023	2026-08-09 14:19:37.023
cmslw2nr3000ai5pyqxt43w8c	健身	title	热点	热点	刘畊宏热度退了，但真正能帮你瘦腰不反弹的，其实是这套髋关节激活法	\N	\N	f	ai	t	2026-08-09 14:19:37.023	2026-08-09 14:19:37.023
cmslw2nr4000bi5pyrphg0liy	健身	title	对比	对比	瑜伽垫vs跑步机：同样练30分钟，燃脂效率差3.7倍，90%人选错了起点	\N	\N	f	ai	t	2026-08-09 14:19:37.024	2026-08-09 14:19:37.024
cmslw2nr5000ci5pyejracjkm	健身	title	对比	对比	7天不节食瘦腰5cm？真实学员打卡日记全公开（附每日动作视频）	\N	\N	f	ai	t	2026-08-09 14:19:37.025	2026-08-09 14:19:37.025
cmslw2nr5000di5py5oxiv37i	健身	title	对比	对比	健身3年反而膝盖疼？原来我一直在用“假深蹲”毁关节	\N	\N	f	ai	t	2026-08-09 14:19:37.026	2026-08-09 14:19:37.026
cmslw2nr6000ei5py50a79emd	健身	title	对比	对比	为什么你越练越累、越练越松？可能是训练强度根本没达标	\N	\N	f	ai	t	2026-08-09 14:19:37.026	2026-08-09 14:19:37.026
cmslw2nr6000fi5pyu32evebo	健身	title	对比	对比	交了钱就没人管”？来我们这儿，首周每天有教练微信复盘你的动作细节	\N	\N	f	ai	t	2026-08-09 14:19:37.027	2026-08-09 14:19:37.027
cmslw2nr7000gi5pyvvx2gb90	健身	title	对比	对比	体验课0元抢｜送价值199元《办公室微运动指南》电子手册（扫码即领）	\N	\N	f	ai	t	2026-08-09 14:19:37.028	2026-08-09 14:19:37.028
cmslw2nr8000hi5pyk7hzm5f4	健身	title	对比	对比	中国营养学会最新报告：76%减脂失败者，蛋白质摄入量不足推荐值的58%	\N	\N	f	ai	t	2026-08-09 14:19:37.028	2026-08-09 14:19:37.028
cmslw2nr8000ii5pyjr7ap2xm	健身	title	对比	对比	她练完第一节课就哭了——不是因为累，是第一次感觉“身体听自己话	\N	\N	f	ai	t	2026-08-09 14:19:37.029	2026-08-09 14:19:37.029
cmslw2nr9000ji5pyzyhrj8ty	健身	title	对比	对比	明明很努力，却总被说没效果”…直到教练发现她骨盆前倾8°	\N	\N	f	ai	t	2026-08-09 14:19:37.029	2026-08-09 14:19:37.029
cmslw2nr9000ki5pyr2ayj3v9	健身	title	对比	对比	小李的蜕变日记：辞职备考期间暴食+熬夜，2个月体脂从32%→24.6%	\N	\N	f	ai	t	2026-08-09 14:19:37.03	2026-08-09 14:19:37.03
cmslw2nra000li5pyexwnbqf6	健身	title	对比	对比	健身小白避坑清单｜这6个“看起来很专业”的动作，90%新手都在错练	\N	\N	f	ai	t	2026-08-09 14:19:37.03	2026-08-09 14:19:37.03
cmslw2nra000mi5pyazul9m3w	健身	title	对比	对比	奥运体能师团队驻店｜国家认证康复师+ACE私教双资质保障每一节课安全	\N	\N	f	ai	t	2026-08-09 14:19:37.031	2026-08-09 14:19:37.031
cmslw2nrb000ni5pyfeyi0ptj	健身	title	对比	对比	练了2个月还是松垮？”别怪自己懒，先看看你的训练计划有没有这3个漏洞	\N	\N	f	ai	t	2026-08-09 14:19:37.031	2026-08-09 14:19:37.031
cmslw2nrb000oi5py1hpe5evw	健身	title	对比	对比	她带着体检报告来上课，3个月后脂肪肝消失，医生主动问她跟哪位教练练的	\N	\N	f	ai	t	2026-08-09 14:19:37.032	2026-08-09 14:19:37.032
cmslw2nrc000pi5pyadz866dk	健身	title	对比	对比	为什么别人练臀翘腿直，你练完只剩酸胀？真相是：你漏掉了离心控制	\N	\N	f	ai	t	2026-08-09 14:19:37.033	2026-08-09 14:19:37.033
cmslw2nrd000qi5pyqlyxvtl2	健身	title	对比	对比	怕被推销”？我们体验课不设销售岗，教练全程只做一件事：帮你找对发力感	\N	\N	f	ai	t	2026-08-09 14:19:37.033	2026-08-09 14:19:37.033
cmslw2nre000ri5pyslnelzdy	健身	title	对比	对比	28岁程序员，连续加班3年腰围涨12cm，第8次尝试健身终于稳住了	\N	\N	f	ai	t	2026-08-09 14:19:37.035	2026-08-09 14:19:37.035
cmslw2nrf000si5py03v4ooy8	健身	title	对比	对比	私教课前必读｜5张对比图告诉你：好教练如何用“微调”代替“猛练	\N	\N	f	ai	t	2026-08-09 14:19:37.035	2026-08-09 14:19:37.035
cmslw2nrf000ti5pyv9p4envc	健身	title	对比	对比	上海静安门店开业福利｜前50名体验者赠筋膜枪+定制运动手账本	\N	\N	f	ai	t	2026-08-09 14:19:37.036	2026-08-09 14:19:37.036
cmslw2nrg000ui5pyr5b9d15m	健身	title	对比	对比	卫健委数据：我国25-44岁人群肌肉量年均流失0.5%-1%，而科学抗衰从30岁开始	\N	\N	f	ai	t	2026-08-09 14:19:37.037	2026-08-09 14:19:37.037
cmslw2nrh000vi5pya5fa89p8	健身	title	对比	对比	他带娃3年没时间锻炼，靠每天12分钟碎片训练，半年腰围缩8cm	\N	\N	f	ai	t	2026-08-09 14:19:37.037	2026-08-09 14:19:37.037
cmslw2nrh000wi5pyxg2a417w	健身	title	对比	对比	练得比谁都勤，就是不见效”——后来才知道，我的基础代谢比同龄人低210大卡	\N	\N	f	ai	t	2026-08-09 14:19:37.038	2026-08-09 14:19:37.038
cmslw2nri000xi5pyp3zohit2	健身	title	对比	对比	教练实拍｜同一套动作，标准发力vs代偿发力，肌肉募集差4.2倍（动图对比）	\N	\N	f	ai	t	2026-08-09 14:19:37.038	2026-08-09 14:19:37.038
cmslw2nri000yi5pyosfk9mow	健身	title	对比	对比	产后修复不是“慢慢养”，而是“精准重建”｜300+妈妈验证过的6周重启计划	\N	\N	f	ai	t	2026-08-09 14:19:37.039	2026-08-09 14:19:37.039
cmslw2nrj000zi5pyv2mhlgn7	健身	title	对比	对比	练瑜伽三年没瘦”？你可能一直在练“装饰性体式”，而非功能性序列	\N	\N	f	ai	t	2026-08-09 14:19:37.039	2026-08-09 14:19:37.039
cmslw2nrj0010i5py7k90yllb	健身	title	对比	对比	北京朝阳馆新升级｜恒温恒湿+独立淋浴间+无推销休息区，体验课可预约时段已开放	\N	\N	f	ai	t	2026-08-09 14:19:37.04	2026-08-09 14:19:37.04
cmslw2nrk0011i5pybpp6r1rp	健身	title	对比	对比	她曾因体态自卑不敢穿露背装，现在成了社群里的“体态纠察员	\N	\N	f	ai	t	2026-08-09 14:19:37.04	2026-08-09 14:19:37.04
cmslw2nrk0012i5pytcgltd2d	健身	title	对比	对比	新手起步清单｜第一次进健身房前，请准备好这4样东西（第3样90%人忽略）	\N	\N	f	ai	t	2026-08-09 14:19:37.041	2026-08-09 14:19:37.041
cmslw2nrl0013i5pyt8xnyxd9	健身	title	对比	对比	ACSM认证教练带队｜美国运动医学会最新《女性力量训练指南》本土化实践	\N	\N	f	ai	t	2026-08-09 14:19:37.041	2026-08-09 14:19:37.041
cmslw2nrl0014i5pyglxy78ci	健身	title	对比	对比	每次练完都肩膀疼”？不是你力气小，是你斜方肌在替整个上肢扛重	\N	\N	f	ai	t	2026-08-09 14:19:37.042	2026-08-09 14:19:37.042
cmslw2nrm0015i5py6f8dllaq	健身	title	对比	对比	杭州西湖店口碑爆棚｜217位会员自发推荐，复购私教课包率达68%	\N	\N	f	ai	t	2026-08-09 14:19:37.043	2026-08-09 14:19:37.043
cmslw2nrn0016i5pyy0gxnnoh	健身	title	对比	对比	她练普拉提第17天，姨妈痛减轻70%，妇科医生建议继续坚持	\N	\N	f	ai	t	2026-08-09 14:19:37.043	2026-08-09 14:19:37.043
cmslw2nrn0017i5pykz56lm4i	健身	title	对比	对比	在家跟练总做不到位？”试试这3个手机支架+镜子自检法，立刻提升动作质量	\N	\N	f	ai	t	2026-08-09 14:19:37.044	2026-08-09 14:19:37.044
cmslw2nro0018i5py1xv6el10	健身	title	对比	对比	私教课值不值？算笔账：单次成本≈一杯奶茶钱，但换来的是12项体能指标可视化追踪	\N	\N	f	ai	t	2026-08-09 14:19:37.044	2026-08-09 14:19:37.044
cmslw2nro0019i5pydxpsar3f	健身	title	对比	对比	健身≠吃苦｜我们把训练拆成“游戏关卡”，学员平均续课周期达14.3个月	\N	\N	f	ai	t	2026-08-09 14:19:37.045	2026-08-09 14:19:37.045
cmslw2nrp001ai5pyc9kh95au	健身	title	对比	对比	怕坚持不了”？我们有“21天伙伴制”：1个教练+2个学友，打卡失败自动触发鼓励机制	\N	\N	f	ai	t	2026-08-09 14:19:37.045	2026-08-09 14:19:37.045
cmslw2nrp001bi5pys2cx13wg	健身	title	对比	对比	她52岁开始练力量，1年后骨密度T值从-2.4	\N	\N	f	ai	t	2026-08-09 14:19:37.046	2026-08-09 14:19:37.046
cmslw3s2n001ci5py9l3a18lc	健身	article	新客引流	\N	\N	新客引流：你刷到这条，不是偶然——是身体在提醒你该动起来了！我们不做“魔鬼训练营”，只提供3节免费体验课：体态评估+定制计划+1对1带练。零推销、不尬聊、不强行办卡。上周有7位朋友试完直接约了私教课，因为第一次就感受到“被看见”：肩颈酸痛、骨盆前倾、久坐无力…都有解法。扫码预约，留个名字+想改善的部位，教练提前为你备好方案。	\N	f	ai	t	2026-08-09 14:20:29.278	2026-08-09 14:20:29.278
cmslw3s2p001di5pyjru402qz	健身	article	老客复购	\N	\N	新客引流：别再收藏“瘦肚子教程”了！真正有效的改变，从一次真实的体验开始。我们为首次到店的朋友准备了「科学启动包」：①AI体态扫描（5分钟出报告）②呼吸+激活微训练③营养师15分钟饮食快问快答。全程无压力，练完还能带走个性化动作库。最近3位宝妈试课后说：“原来不是我懒，是方法错了。”你的身体，值得被专业对待。	\N	f	ai	t	2026-08-09 14:20:29.281	2026-08-09 14:20:29.281
cmslw3s2q001ei5pyg8ip6p69	健身	article	产品种草	\N	\N	新客引流：离家/公司步行10分钟内？恭喜你解锁高效健身新可能！我们坚持“小而精”社区馆模式：恒温恒湿、器械分区、女性专属时段、储物柜带USB充电口。现在预约首节体验课，送《居家碎片化训练手册》（含6个办公室/卧室可做的动作视频）。不画大饼，只做一件事：让你练得懂、练得稳、练得开心。	\N	f	ai	t	2026-08-09 14:20:29.282	2026-08-09 14:20:29.282
cmslw3s2r001fi5py8xusfylv	健身	article	客户见证	\N	\N	老客复购：上个月续卡的李姐说：“不是因为便宜，是因为每次练完都像充了电。”我们懂——坚持不是靠意志力，而是靠“被支持感”。老会员续费享3重专属：①季度体测免费升级（加测基础代谢+肌肉失衡分析）②私教课时包折上折③优先锁定黄金时段。你的进步，我们记得比你更清楚。	\N	f	ai	t	2026-08-09 14:20:29.284	2026-08-09 14:20:29.284
cmslw3s2s001gi5pyi1j3m4pm	健身	article	节假日活动	\N	\N	老客复购：你坚持了87天，打卡率92%，体脂降了3.2%——这些数据，我们都存着。老会员回归即赠「进阶能量包」：1节运动康复微课+1份定制补剂建议（非推销）+1次筋膜枪放松体验。不催你买，只陪你走得更远。毕竟，真正的复购，从来不是销售的结果，而是信任的回响。	\N	f	ai	t	2026-08-09 14:20:29.285	2026-08-09 14:20:29.285
cmslw3s2t001hi5pyircl4lhs	健身	article	品牌故事	\N	\N	老客复购：还记得你第一次做标准深蹲时膝盖打颤的样子吗？现在你能稳稳完成12次单腿臀桥。变化不会轰轰烈烈，但每一步都算数。即日起老会员续卡，赠送「成长影像册」：教练手写进步笔记+季度对比照（自愿提供）+语音鼓励条。你值得被温柔记录，而不是被数字定义。	\N	f	ai	t	2026-08-09 14:20:29.286	2026-08-09 14:20:29.286
cmslw3s2u001ii5pys2cq4gya	健身	article	上新公告	\N	\N	产品种草：不是所有“普拉提”都叫功能性普拉提。我们的课程基于Postural Restoration Institute（PRI）体系，专治圆肩驼背、假胯宽、产后腹直肌分离。每节课含呼吸重建+神经肌肉再教育+生活动作迁移。学员反馈：“练完第二天走路都不一样了。”器械用德国BMC，垫子每客一换，连毛巾都是抑菌棉。效果，藏在细节里。	\N	f	ai	t	2026-08-09 14:20:29.287	2026-08-09 14:20:29.287
cmslw3s2v001ji5pyoec21fww	健身	article	优惠活动	\N	\N	产品种草：私教课≠贵=贵得值。我们教练全员持NASM-CES（矫正运动专家）或PTR认证，平均授课5年以上。每节私教课前必做动态评估，课后生成文字版训练日志（含动作要点+生活提醒）。最近王同学用12节课改善膝痛，医生复查说“软组织代偿明显改善”。好课，经得起专业检验。	\N	f	ai	t	2026-08-09 14:20:29.288	2026-08-09 14:20:29.288
cmslw3s2w001ki5pyvj13sd4p	健身	article	知识科普	\N	\N	产品种草：瑜伽不是摆姿势，是重建身体与意识的连接。我们的阴瑜伽+筋膜松解融合课，采用Joanne Avison教学体系，辅以红外热成像仪监测放松深度。每节课预留10分钟“身体对话时间”——教练会问：“今天肩膀最想说什么？”已帮助43位高压职场人找回睡眠力。柔软，是力量的另一种表达。	\N	f	ai	t	2026-08-09 14:20:29.289	2026-08-09 14:20:29.289
cmslw3s2x001li5pyqd6kv3my	健身	article	互动话题	\N	\N	客户见证：林薇，32岁，广告策划｜体态改善期16周｜变化：头前伸减少2.3cm，久坐腰痛消失，穿高跟鞋不再脚踝外翻。“以前以为瑜伽就是拉伸，直到教练指出我的呼吸模式错误——肋骨长期塌陷导致核心失活。现在开会前做3分钟‘肋间唤醒’，脑子都清醒了。”（附体态对比动图）	\N	f	ai	t	2026-08-09 14:20:29.29	2026-08-09 14:20:29.29
cmslw3s2y001mi5pyevnl43y9	健身	article	答疑辟谣	\N	\N	客户见证：陈哲，38岁，程序员｜减脂塑形期24周｜变化：体脂率从26.8%→18.5%，血压回归正常值，体检报告“脂肪肝”变“未见异常”。“没节食！教练把我的外卖习惯拆解成‘蛋白质锚点法’：午餐先吃肉蛋，再配半拳蔬菜。21天后饥饿感消失了，连奶茶都自动不想喝了。”（附餐盘实拍+体检单局部）	\N	f	ai	t	2026-08-09 14:20:29.29	2026-08-09 14:20:29.29
cmslw3s2z001ni5pyo4mpg3t0	健身	article	会员权益	\N	\N	客户见证：吴婷，29岁，二胎妈妈｜产后修复期18周｜变化：腹直肌间距从3指缩至1指，漏尿问题停止，抱娃时腰不酸了。“生完二宝不敢练，怕加重盆底。教练用生物反馈仪+低频电刺激+呼吸协同训练，全程无痛无尴尬。现在每天陪娃爬行，自己也像重新长出了核心。”（附亲子训练合影）	\N	f	ai	t	2026-08-09 14:20:29.291	2026-08-09 14:20:29.291
cmslw3s2z001oi5pyepwptst4	健身	article	会员权益	\N	\N	节假日活动：春节不躺平，健康年味才够劲！除夕至初七，到店即赠「新春能量礼盒」：定制筋膜球+暖姜茶包+手写福字训练日历（每日1个3分钟微动作）。连续打卡5天，抽3人免单月卡；带家人同练，长辈享免费体态筛查。新年目标不用宏大，从“站直吃饭”开始。	\N	f	ai	t	2026-08-09 14:20:29.292	2026-08-09 14:20:29.292
cmslw3s30001pi5py39rj7bcn	健身	article	会员权益	\N	\N	节假日活动：五一不扎堆旅行，来场身体重启之旅！劳动节特辑：①“办公室战士”肩颈急救课（限15人）②“久坐族”髋关节解放工作坊③家庭亲子体能挑战赛（孩子玩，爸妈学动作逻辑）。报名即送《假期防垮指南》电子书（含旅行途中拉伸图解+酒店房间训练方案）。	\N	f	ai	t	2026-08-09 14:20:29.293	2026-08-09 14:20:29.293
cmslw3s31001qi5pyp43kbu5k	健身	article	会员权益	\N	\N	节假日活动：中秋不只吃月饼，更要“吃掉”疲惫感！9月15-21日，参与「月光训练营」：每晚20:00线上直播·呼吸冥想+下肢激活+助眠拉伸，连续7天打卡送「桂花乌龙蛋白棒」（0蔗糖）。线下同步开放“团圆夜场”：夫妻/闺蜜/母女同练享双人价，练完共饮养生茶。爱自己，是最长情的团圆。	\N	f	ai	t	2026-08-09 14:20:29.294	2026-08-09 14:20:29.294
cmslw3s32001ri5pyqjve31rs	健身	article	会员权益	\N	\N	品牌故事：2017年，创始人阿哲做完第7次腰椎理疗后，在康复科门口蹲了半小时。他发现：太多人不是不想动，是怕错、怕伤、怕白花钱。于是辞去三甲医院康复师工作，在老城区租下80㎡仓库，亲手刷墙、调试器械、设计第一套“零基础启动课”。7年过去，这里仍没有LED大屏和震耳音乐，只有看得见的进步，和听得见的呼吸。	\N	f	ai	t	2026-08-09 14:20:29.294	2026-08-09 14:20:29.294
cmslw3s33001si5pysonkpm84	健身	article	会员权益	\N	\N	品牌故事：我们的镜子不贴励志标语，只贴一行小字：“你今天的呼吸，比昨天深了0.3秒。”这是教练组坚持7年的传统——每面镜子背后，都藏着一位会员的真实进步时刻。有人在这里告别护腰带，有人第一次穿上露背装，有人带着化疗后的虚弱重新学会蹲起……健身不是改造身体，是帮它找回本来的样子。	\N	f	ai	t	2026-08-09 14:20:29.295	2026-08-09 14:20:29.295
cmslw3s34001ti5pywwh34mj6	健身	article	会员权益	\N	\N	品牌故事：馆里那台用了6年的TRX悬挂带，金属扣磨得发亮，却从不更换——因为上面刻着237个名字：有刚做完手术的老人，有备战艺考的高中生，有做完乳腺切除的姐姐。我们相信：器械会旧，但支持不该设限。所有课程默认含无障碍适配选项，教练接受过残障运动支持专项培训。力量，本就该人人可及。	\N	f	ai	t	2026-08-09 14:20:29.296	2026-08-09 14:20:29.296
cmslw3s35001ui5pywuwqjih7	健身	article	会员权益	\N	\N	上新公告：重磅上线｜「代谢重启营」春季限定！针对易胖难瘦、喝凉水都囤腹、午后犯困人群，联合注册营养师+运动生理学博士研发：①4周代谢适应性训练（含冷热交替激活）②个性化宏量配比方案③每日代谢波动追踪表。首期仅开放30席，含2次基础代谢率检测（价值380元）。	\N	f	ai	t	2026-08-09 14:20:29.297	2026-08-09 14:20:29.297
cmslw3s36001vi5py0u633os1	健身	article	会员权益	\N	\N	上新公告：新手友好升级！全新「启明团课」系列上线：①《呼吸是第一块腹肌》②《蹲下去，就站起来》③《肩颈不是硬，是卡住了》。每节45分钟，全镜面教室+实时动作纠偏投影，课后生成个人优化建议。首周体验价59元/节（原价168），老会员带新赠1节。	\N	f	ai	t	2026-08-09 14:20:29.298	2026-08-09 14:20:29.298
cmslw3s37001wi5pyqraid8ks	健身	article	会员权益	\N	\N	上新公告：终于等到你！女性专属「经期友好训练区」正式启用：恒温26℃、独立通风、配备暖宫贴&红糖水自助台、所有器械加装防滑硅胶套。配套上线《周期力量课》——按卵泡期/黄体期/经期动态调整强度，连瑜伽垫都换成加厚记忆棉。身体知道何时发力，我们负责托住它。	\N	f	ai	t	2026-08-09 14:20:29.299	2026-08-09 14:20:29.299
cmslw3s38001xi5pyjnchg4s7	健身	article	会员权益	\N	\N	优惠活动：限时48小时｜「信任启动价」开放中！新客首月卡99元（含3节体验课+1次体态报告+运动包），老会员推荐成功，双方各得200元无门槛券（可抵私教/营养咨询/周边）。所有优惠券永久有效，过期自动延期。我们不怕你犹豫，只怕你错过开始的勇气。	\N	f	ai	t	2026-08-09 14:20:29.3	2026-08-09 14:20:29.3
cmslw3s38001yi5pyl6s5kqgs	健身	article	会员权益	\N	\N	优惠活动：618不拼价格，拼诚意！即日起：①年卡送12节私教课（分月解锁）②私教课包满10000减1800，再赠《运动营养手账》③携伴侣/闺蜜同行，第二人享半价（限首次购卡）。所有优惠叠加可用，且支持分期0利息。投资健康，本就不该有门槛。	\N	f	ai	t	2026-08-09 14:20:29.301	2026-08-09 14:20:29.301
cmslw3s39001zi5pyzviag672	健身	article	会员权益	\N	\N	优惠活动：毕业季特别计划｜学生凭校园卡享全年最低价：月卡68元、季卡198元、半年卡368元（均含体态评估+饮食简析+社群答疑）。另赠《职场新人体态自救指南》（含久坐办公椅调整术+通勤碎片训练）。青春很贵，但你的健康，我们承包一半。	\N	f	ai	t	2026-08-09 14:20:29.302	2026-08-09 14:20:29.302
cmslw3s3a0020i5pyb24jlopq	健身	article	会员权益	\N	\N	知识科普：深蹲膝盖不能过脚尖？错！研究证实：适度前移反而降低腰椎剪切力。真正危险的是“膝盖内扣+脚踝僵硬”。教你自测：赤脚单腿蹲，看足弓是否塌陷、膝盖是否向内偏移。改善只需3步：①每天踩网球松解足底筋膜 ②弹力带侧步走激活臀中肌 ③靠墙静蹲时想象“屁股往后坐”。	\N	f	ai	t	2026-08-09 14:20:29.303	2026-08-09 14:20:29.303
cmslw3s3b0021i5pyd9eyulsh	健身	article	会员权益	\N	\N	知识科普：	\N	f	ai	t	2026-08-09 14:20:29.304	2026-08-09 14:20:29.304
cmslw466z0022i5pygkfmvzjx	健身	topic	\N	\N	春天瘦腰计划｜3月「梨形身材」学员打卡21天，腰臀比从0.92→0.78的真实记录	\N	\N	f	ai	t	2026-08-09 14:20:47.579	2026-08-09 14:20:47.579
cmslw46730023i5py3yqowit8	健身	topic	\N	\N	清明踏青前速效塑形｜4组居家徒手动作，不用器械也能紧致大腿内侧	\N	\N	f	ai	t	2026-08-09 14:20:47.583	2026-08-09 14:20:47.583
cmslw46740024i5pya03b5jcx	健身	topic	\N	\N	五一出游穿搭焦虑？5月「肩背线条急救课」体验课免费开放（限30人）	\N	\N	f	ai	t	2026-08-09 14:20:47.584	2026-08-09 14:20:47.584
cmslw46750025i5pyk7xrc81p	健身	topic	\N	\N	高考季家长减压训练｜陪考妈妈专属：每天15分钟缓解肩颈僵硬+改善睡眠	\N	\N	f	ai	t	2026-08-09 14:20:47.586	2026-08-09 14:20:47.586
cmslw46760026i5pyym8pgy3s	健身	topic	\N	\N	618健身消费冷静期｜我们把私教课拆成「单次体验包」，练完再决定要不要续	\N	\N	f	ai	t	2026-08-09 14:20:47.587	2026-08-09 14:20:47.587
cmslw46780027i5pyl2tlktls	健身	topic	\N	\N	夏至燃脂黄金期｜教练实测：同一套HIIT，下午4点vs晚上8点燃脂效率差37%	\N	\N	f	ai	t	2026-08-09 14:20:47.588	2026-08-09 14:20:47.588
cmslw46780028i5pysu1lorbf	健身	topic	\N	\N	暑假亲子运动日｜带娃来馆免费领《家庭趣味体能卡》，打卡满5次送儿童体态评估	\N	\N	f	ai	t	2026-08-09 14:20:47.589	2026-08-09 14:20:47.589
cmslw46790029i5pysslu3uda	健身	topic	\N	\N	七夕不只送礼｜情侣双人体验课上线：同步训练+饮食搭配方案，报名即赠合照精修	\N	\N	f	ai	t	2026-08-09 14:20:47.589	2026-08-09 14:20:47.589
cmslw467a002ai5pyrn3sk51c	健身	topic	\N	\N	立秋贴秋膘预警｜营养师出镜：3顿「高饱腹低热量」餐，吃够热量也不胖	\N	\N	f	ai	t	2026-08-09 14:20:47.59	2026-08-09 14:20:47.59
cmslw467a002bi5pychpmz71h	健身	topic	\N	\N	教师节特别企划｜凭教师证免体验课费，加赠《久坐人群脊柱放松指南》电子手册	\N	\N	f	ai	t	2026-08-09 14:20:47.591	2026-08-09 14:20:47.591
cmslw467b002ci5pyn58k7hon	健身	topic	\N	\N	国庆长假后体态修复｜7天「圆肩驼背矫正挑战」，每日跟练视频+教练1v1反馈	\N	\N	f	ai	t	2026-08-09 14:20:47.591	2026-08-09 14:20:47.591
cmslw467b002di5py4mkxf0tl	健身	topic	\N	\N	双十一理性健身指南｜对比10家健身房合同条款，我们公开承诺「无隐形扣费」	\N	\N	f	ai	t	2026-08-09 14:20:47.592	2026-08-09 14:20:47.592
cmslw467c002ei5py9jo3ajt0	健身	topic	\N	\N	冬至暖身不囤脂｜热饮+动态拉伸组合：低温环境下高效燃脂的3个关键动作	\N	\N	f	ai	t	2026-08-09 14:20:47.592	2026-08-09 14:20:47.592
cmslw467d002fi5py9d9jyq3g	健身	topic	\N	\N	元旦flag别倒！「21天习惯养成营」启动：签到打卡+体脂检测+教练晨间督学	\N	\N	f	ai	t	2026-08-09 14:20:47.593	2026-08-09 14:20:47.593
cmslw467d002gi5py8o3itz2f	健身	topic	\N	\N	春节返乡体态警报｜久坐火车/沙发瘫后，5分钟「腰椎归位操」跟练版上线	\N	\N	f	ai	t	2026-08-09 14:20:47.594	2026-08-09 14:20:47.594
cmslw467e002hi5pyjjqm6e9h	健身	topic	\N	\N	情人节第二弹｜单身友好型训练课：不配对、不比较，专注自己的进步节奏	\N	\N	f	ai	t	2026-08-09 14:20:47.594	2026-08-09 14:20:47.594
cmslw467f002ii5py92mhkfwd	健身	topic	\N	\N	雨水节气关节养护｜瑜伽教练示范：阴雨天膝盖不适的4个自测+缓解动作	\N	\N	f	ai	t	2026-08-09 14:20:47.595	2026-08-09 14:20:47.595
cmslw467g002ji5py704o01yo	健身	topic	\N	\N	三八妇女节专属｜女性力量训练公开课：经期能练吗？产后如何安全重启？	\N	\N	f	ai	t	2026-08-09 14:20:47.596	2026-08-09 14:20:47.596
cmslw467g002ki5py1dsyhfz3	健身	topic	\N	\N	谷雨养肝瘦身｜中医体质辨识+定制化运动建议：湿热/气虚/痰湿型怎么动更有效	\N	\N	f	ai	t	2026-08-09 14:20:47.597	2026-08-09 14:20:47.597
cmslw467h002li5pylpscshon	健身	topic	\N	\N	五一调休补班日｜午间「办公室微训练」直播：椅子就能做的肩颈放松+核心激活	\N	\N	f	ai	t	2026-08-09 14:20:47.598	2026-08-09 14:20:47.598
cmslw467i002mi5pynk0cp48f	健身	topic	\N	\N	端午艾草香囊赠课｜体验课学员每人领「祛湿助眠香囊」+节气饮食小贴士	\N	\N	f	ai	t	2026-08-09 14:20:47.598	2026-08-09 14:20:47.598
cmslw467k002ni5pyi83pfko1	健身	topic	\N	\N	夏至夜跑安全指南｜教练带队夜训实拍：反光装备选择、心率区间控制、补电解质技巧	\N	\N	f	ai	t	2026-08-09 14:20:47.6	2026-08-09 14:20:47.6
cmslw467k002oi5pya1rnpega	健身	topic	\N	\N	处暑防秋乏｜「精力管理训练法」首发：用力量训练提升白天专注力，附HRV监测解读	\N	\N	f	ai	t	2026-08-09 14:20:47.601	2026-08-09 14:20:47.601
cmslw467l002pi5pya58euxvq	健身	topic	\N	\N	教师节二次传播｜晒出你的「粉笔灰肩颈照」，抽10人免费做筋膜刀放松体验	\N	\N	f	ai	t	2026-08-09 14:20:47.602	2026-08-09 14:20:47.602
cmslw467m002qi5py8zic4qv5	健身	topic	\N	\N	中秋团圆饭后自救｜3组「肠胃友好型」腹部训练，边看晚会边练，不耽误团聚	\N	\N	f	ai	t	2026-08-09 14:20:47.602	2026-08-09 14:20:47.602
cmslw467m002ri5pymjkgu870	健身	topic	\N	\N	立冬进补不增重｜营养师×教练联名：蛋白质分配时间表+抗阻训练节奏建议	\N	\N	f	ai	t	2026-08-09 14:20:47.603	2026-08-09 14:20:47.603
cmslw467n002si5pyi0fz156f	健身	topic	\N	\N	双十二轻资产健身｜「99元单器械月卡」上线：只开放跑步机/椭圆机/壶铃区，透明计费	\N	\N	f	ai	t	2026-08-09 14:20:47.603	2026-08-09 14:20:47.603
cmslw467n002ti5pywl8zvrlw	健身	topic	\N	\N	小寒抗寒力训练｜体温提升计划：通过肌肉产热提升基础代谢，附体感温度自测表	\N	\N	f	ai	t	2026-08-09 14:20:47.604	2026-08-09 14:20:47.604
cmslw467o002ui5pydbodxzxn	健身	topic	\N	\N	春节后复工塑形｜「假期松弛肌唤醒计划」：从呼吸模式重建开始，告别懒散体态	\N	\N	f	ai	t	2026-08-09 14:20:47.604	2026-08-09 14:20:47.604
cmslw467o002vi5py7i6vslpl	健身	topic	\N	\N	腊八暖身燃脂粥｜馆内免费派发「黑豆藜麦暖体粥」+配套10分钟晨间激活操	\N	\N	f	ai	t	2026-08-09 14:20:47.605	2026-08-09 14:20:47.605
cmslw4hbj002wi5pyraczk25b	健身	image_prompt	\N	\N	\N	一张现代简约风格的健身房器械特写，哑铃与弹力带整齐摆放于浅灰水泥地面，阳光从落地窗斜射入内，ins风滤镜，柔和自然光，干净构图，俯拍视角	\N	f	ai	t	2026-08-09 14:21:02	2026-08-09 14:21:02
cmslw4hbl002xi5pyr5cstnvo	健身	image_prompt	\N	\N	\N	专业教练指导学员做深蹲动作的高清写实场景，汗水微光、肌肉线条清晰可见，背景虚化呈现器械区，真实光影，中景平视，运动服品牌细节可见	\N	f	ai	t	2026-08-09 14:21:02.002	2026-08-09 14:21:02.002
cmslw4hbn002yi5pyf3uj1omb	健身	image_prompt	\N	\N	\N	国潮风健身器械海报：太极云手 silhouette 与杠铃融合设计，红金配色，水墨渐变底纹，「气力合一」书法字体居中，传统纹样边框，竖版构图	\N	f	ai	t	2026-08-09 14:21:02.003	2026-08-09 14:21:02.003
cmslw4hbo002zi5pyedhriqsl	健身	image_prompt	\N	\N	\N	ins风门店外景：玻璃门上贴有「Free Trial Class」手写字体贴纸，门口绿植垂落，浅木色门框与白色墙面，柔焦+奶油色调，午后暖光，低角度仰拍	\N	f	ai	t	2026-08-09 14:21:02.004	2026-08-09 14:21:02.004
cmslw4hbp0030i5pywvm7q9p6	健身	image_prompt	\N	\N	\N	写实风格前台实景：穿 Polo 衫的前台人员微笑递出体验课预约卡，背后是整洁的品牌LOGO墙与实时更新的课程表电子屏，自然光线，生活化抓拍感，中景	\N	f	ai	t	2026-08-09 14:21:02.005	2026-08-09 14:21:02.005
cmslw4hbp0031i5pydp38wdsn	健身	image_prompt	\N	\N	\N	国潮风门店空间图：青砖墙搭配铜制「筋骨堂」匾额，竹编灯罩下瑜伽垫错落排布，水墨山峦壁纸与金属器械形成古今碰撞，对称构图，赭石+靛青主色	\N	f	ai	t	2026-08-09 14:21:02.006	2026-08-09 14:21:02.006
cmslw4hbq0032i5py2586lek4	健身	image_prompt	\N	\N	\N	ins风活动海报：三位不同体型学员击掌跃起瞬间，发丝飞扬，背景为模糊的荧光色课程表投影，马卡龙色块拼贴边框，动态模糊+高饱和但不刺眼	\N	f	ai	t	2026-08-09 14:21:02.007	2026-08-09 14:21:02.007
cmslw4hbr0033i5pycln3rbjf	健身	image_prompt	\N	\N	\N	写实风格团课现场：周六早间燃脂课，20人同步做波比跳，教练用激光笔指示动作要点，汗水滴落地板反光，广角镜头捕捉空间纵深与参与感	\N	f	ai	t	2026-08-09 14:21:02.007	2026-08-09 14:21:02.007
cmslw4hbr0034i5py1vycl3wn	健身	image_prompt	\N	\N	\N	国潮风促销海报：舞狮头造型哑铃icon，祥云纹环绕「七日体验营」标题，二维码嵌入铜钱纹中央，朱砂红底+烫金工艺质感，传统年画比例	\N	f	ai	t	2026-08-09 14:21:02.008	2026-08-09 14:21:02.008
cmslw4hbs0035i5pyctci5g8n	健身	image_prompt	\N	\N	\N	ins风客户对比图：同一女性侧身站姿拼贴（左：宽松T恤/微驼背；右：修身背心/挺拔体态），背景均为浅橡木色更衣室墙面，柔光+胶片颗粒感，无文字干扰	\N	f	ai	t	2026-08-09 14:21:02.008	2026-08-09 14:21:02.008
cmslw4hbs0036i5pyn9f9mo4c	健身	image_prompt	\N	\N	\N	写实风格训练记录册特写：手写体「第87天｜体脂率-3.2%｜教练：王磊」字迹清晰，旁边放着泛旧的运动水壶和体检报告一角，自然光桌面静物，微距拍摄	\N	f	ai	t	2026-08-09 14:21:02.009	2026-08-09 14:21:02.009
cmslw4hbu0037i5pycnmahhyd	健身	image_prompt	\N	\N	\N	国潮风蜕变故事插画：水墨风格女子从「伏案久坐」到「山顶展臂」的三段式长卷，留白处题小楷「动则生阳」，青绿山水为底，绢本质感	\N	f	ai	t	2026-08-09 14:21:02.01	2026-08-09 14:21:02.01
cmslw4hbv0038i5pyi7scpcu2	健身	image_prompt	\N	\N	\N	ins风训练日常：清晨空镜——瑜伽垫卷起一半，蛋白粉勺斜插在燕麦杯里，窗台多肉植物投下细长影子，莫兰迪色系，静谧治愈感，45度俯拍	\N	f	ai	t	2026-08-09 14:21:02.011	2026-08-09 14:21:02.011
cmslw4hbx0039i5pyi2mxb3p8	健身	image_prompt	\N	\N	\N	写实风格私教课片段：女教练单膝跪地调整学员髋关节角度，手势精准，学员闭眼专注感受，背景虚化显示训练计划白板，真实抓拍，暖黄灯光	\N	f	ai	t	2026-08-09 14:21:02.013	2026-08-09 14:21:02.013
cmslw4hbz003ai5pypmighj3b	健身	image_prompt	\N	\N	\N	国潮风社群氛围图：微信聊天截图艺术化处理——「今天跟练成功！」消息气泡里嵌入剪纸风肌肉小人，背景为水墨晕染的「自律者联盟」群名，朱砂印章点缀	\N	f	ai	t	2026-08-09 14:21:02.015	2026-08-09 14:21:02.015
cmslw52j1003bi5pyt1h613wv	母婴	title	数字	数字	3个被90%新手妈妈忽略的新生儿喂养细节，第2个医生都点头	\N	\N	f	ai	t	2026-08-09 14:21:29.484	2026-08-09 14:21:29.484
cmslw52j3003ci5pywj8qi7ym	母婴	title	反差	反差	月嫂说没事”vs“儿科医生说必须停”，这5种红屁屁处理法差太多	\N	\N	f	ai	t	2026-08-09 14:21:29.487	2026-08-09 14:21:29.487
cmslw52j4003di5pyd1o7kdd3	母婴	title	疑问	疑问	宝宝湿疹反复？你可能每天都在做这3件加重的事	\N	\N	f	ai	t	2026-08-09 14:21:29.489	2026-08-09 14:21:29.489
cmslw52j6003ei5py1jlpodol	母婴	title	痛点	痛点	月薪2万请的月嫂，居然连这4个基础早教动作都不会做	\N	\N	f	ai	t	2026-08-09 14:21:29.49	2026-08-09 14:21:29.49
cmslw52j7003fi5pyvu3eb7x2	母婴	title	福利	福利	免费领｜三甲医院产科护士整理的《产后黄金72小时自查清单》	\N	\N	f	ai	t	2026-08-09 14:21:29.491	2026-08-09 14:21:29.491
cmslw52j7003gi5pyunkcehwa	母婴	title	权威数据	权威数据	国家卫健委最新数据：87%的婴儿肠绞痛，其实和奶瓶角度有关	\N	\N	f	ai	t	2026-08-09 14:21:29.492	2026-08-09 14:21:29.492
cmslw52j8003hi5pyk9fka57g	母婴	title	悬念	悬念	刚出月子就漏尿？别急着练凯格尔，先查这2个被忽视的信号	\N	\N	f	ai	t	2026-08-09 14:21:29.493	2026-08-09 14:21:29.493
cmslw52j9003ii5pyyiug6qgd	母婴	title	共情	共情	别人家宝宝6个月会坐，我家还软趴趴…”这种焦虑，我懂	\N	\N	f	ai	t	2026-08-09 14:21:29.494	2026-08-09 14:21:29.494
cmslw52ja003ji5py5ay70lcv	母婴	title	故事	故事	二胎妈妈深夜崩溃哭完，把这本《哺乳期情绪自救手账》写满了	\N	\N	f	ai	t	2026-08-09 14:21:29.495	2026-08-09 14:21:29.495
cmslw52jb003ki5pyofblt2t5	母婴	title	清单	清单	0-6岁宝宝防晒必看的5个成分黑名单，第4个90%母婴店还在卖	\N	\N	f	ai	t	2026-08-09 14:21:29.495	2026-08-09 14:21:29.495
cmslw52jc003li5pyspc616qz	母婴	title	热点	热点	《再见爱人4》爆火后，越来越多妈妈开始警惕“母职绑架”式育儿	\N	\N	f	ai	t	2026-08-09 14:21:29.496	2026-08-09 14:21:29.496
cmslw52jc003mi5py3ltszgpw	母婴	title	对比	对比	国产奶粉vs进口奶粉：钙铁锌含量对比表曝光，第3项差距惊人	\N	\N	f	ai	t	2026-08-09 14:21:29.497	2026-08-09 14:21:29.497
cmslw52jd003ni5pye05zovax	母婴	title	对比	对比	7天搞定宝宝夜醒频繁，不用戒夜奶也能睡整觉的实操方案	\N	\N	f	ai	t	2026-08-09 14:21:29.498	2026-08-09 14:21:29.498
cmslw52je003oi5pyk2p5d2sl	母婴	title	对比	对比	婆婆说裹住就不冷”vs“温湿度计显示28℃”，这3种捂热误区害娃入院	\N	\N	f	ai	t	2026-08-09 14:21:29.499	2026-08-09 14:21:29.499
cmslw52jf003pi5pyime7lxki	母婴	title	对比	对比	宝宝辅食添加总过敏？先问自己这4个问题答对没	\N	\N	f	ai	t	2026-08-09 14:21:29.5	2026-08-09 14:21:29.5
cmslw52jg003qi5py8m3ovjsx	母婴	title	对比	对比	产后抑郁不是矫情！这5个身体信号比情绪更早预警	\N	\N	f	ai	t	2026-08-09 14:21:29.5	2026-08-09 14:21:29.5
cmslw52jg003ri5pyxka9svna	母婴	title	对比	对比	限时开放｜孕晚期专属「顺产模拟舱」体验预约（含胎心监护解读）	\N	\N	f	ai	t	2026-08-09 14:21:29.501	2026-08-09 14:21:29.501
cmslw52jg003si5pys9tuzekk	母婴	title	对比	对比	2024年中疾控报告：婴幼儿手口病高发季提前2周，家长必做3件事	\N	\N	f	ai	t	2026-08-09 14:21:29.501	2026-08-09 14:21:29.501
cmslw52jh003ti5pykmiv424k	母婴	title	对比	对比	哺乳期喝咖啡真的回奶？浙大儿院营养科主任亲自辟谣	\N	\N	f	ai	t	2026-08-09 14:21:29.502	2026-08-09 14:21:29.502
cmslw52ji003ui5py99lnsvit	母婴	title	对比	对比	孩子不认生=性格好？”错！这4种社交退缩信号才是发育关键	\N	\N	f	ai	t	2026-08-09 14:21:29.502	2026-08-09 14:21:29.502
cmslw52ji003vi5pywr90evgc	母婴	title	对比	对比	产科护士长陪产12年，悄悄记下的7个产房真实对话	\N	\N	f	ai	t	2026-08-09 14:21:29.503	2026-08-09 14:21:29.503
cmslw52jj003wi5pyh6tvai9g	母婴	title	对比	对比	北京协和产科团队研发｜《0-3岁宝宝睡眠节律养成图谱》免费领	\N	\N	f	ai	t	2026-08-09 14:21:29.504	2026-08-09 14:21:29.504
cmslw52jl003xi5pyx9ekvab7	母婴	title	对比	对比	别人家娃吃啥都香，我家只肯喝奶…”试试这5招食物暴露法	\N	\N	f	ai	t	2026-08-09 14:21:29.505	2026-08-09 14:21:29.505
cmslw52jm003yi5py4oi5p8uy	母婴	title	对比	对比	奶粉罐底那串数字藏着什么？读懂它，避开90%的临期/调货风险	\N	\N	f	ai	t	2026-08-09 14:21:29.506	2026-08-09 14:21:29.506
cmslw52jn003zi5pyy6sbyryg	母婴	title	对比	对比	立夏后宝宝易积食？中医儿科提醒：这3碗汤比山楂丸更温和安全	\N	\N	f	ai	t	2026-08-09 14:21:29.507	2026-08-09 14:21:29.507
cmslw52jn0040i5py4243w68y	母婴	title	对比	对比	月嫂证书在手，却不会识别新生儿黄疸值”——托育机构资质避坑指南	\N	\N	f	ai	t	2026-08-09 14:21:29.508	2026-08-09 14:21:29.508
cmslw52jo0041i5py423pwp4z	母婴	title	对比	对比	上海某私立医院日均接诊43例婴儿乳糖不耐，但9成家长误判为过敏	\N	\N	f	ai	t	2026-08-09 14:21:29.509	2026-08-09 14:21:29.509
cmslw52jp0042i5pya9neeg8a	母婴	title	对比	对比	产后第一次来月经，量少颜色深…是不是子宫没恢复好？	\N	\N	f	ai	t	2026-08-09 14:21:29.509	2026-08-09 14:21:29.509
cmslw52jp0043i5pyjltlf1wp	母婴	title	对比	对比	产检B超单上这个数值异常，可能预示宝宝未来语言发育节奏	\N	\N	f	ai	t	2026-08-09 14:21:29.51	2026-08-09 14:21:29.51
cmslw52jq0044i5py2lt6jrto	母婴	title	对比	对比	刚辞职带娃的95后妈妈，用Excel记录3个月作息，意外发现哄睡黄金窗口	\N	\N	f	ai	t	2026-08-09 14:21:29.51	2026-08-09 14:21:29.51
cmslw52jq0045i5py10yxl4wd	母婴	title	对比	对比	母婴店热销TOP3纸尿裤实测：吸水速度、反渗率、氨味残留全对比	\N	\N	f	ai	t	2026-08-09 14:21:29.511	2026-08-09 14:21:29.511
cmslw52jr0046i5py7anttmz8	母婴	title	对比	对比	端午将至，这些传统驱蚊法真安全吗？疾控中心发布婴幼儿版避雷清单	\N	\N	f	ai	t	2026-08-09 14:21:29.511	2026-08-09 14:21:29.511
cmslw52jr0047i5pyibcngcs7	母婴	title	对比	对比	宝宝打疫苗后发烧，是免疫系统在工作”——但这件事比退烧更重要	\N	\N	f	ai	t	2026-08-09 14:21:29.512	2026-08-09 14:21:29.512
cmslw52js0048i5pypgeh1br6	母婴	title	对比	对比	新生儿黄疸值超12.8就要照蓝光？最新共识：还要看这2个动态指标	\N	\N	f	ai	t	2026-08-09 14:21:29.513	2026-08-09 14:21:29.513
cmslw52jt0049i5py5y5ok5ay	母婴	title	对比	对比	待产包里最鸡肋的6样东西，第4个95%的准妈妈都塞进去了	\N	\N	f	ai	t	2026-08-09 14:21:29.513	2026-08-09 14:21:29.513
cmslw52jt004ai5py4t4nyw3c	母婴	title	对比	对比	孩子总揉眼睛、眨眼频繁”，眼科医生说：先停用这2类儿童洗护品	\N	\N	f	ai	t	2026-08-09 14:21:29.514	2026-08-09 14:21:29.514
cmslw52ju004bi5pyfa0hhyf2	母婴	title	对比	对比	卫健委新指南：0-1岁宝宝维生素D补充，不再统一400IU，要看这3点	\N	\N	f	ai	t	2026-08-09 14:21:29.514	2026-08-09 14:21:29.514
cmslw52jv004ci5pynxbz2rvd	母婴	title	对比	对比	产康师从业10年坦言：骨盆修复≠绑束腹带，真正起效的是这3个动作	\N	\N	f	ai	t	2026-08-09 14:21:29.515	2026-08-09 14:21:29.515
cmslw52jw004di5pya17c2cr5	母婴	title	对比	对比	宝宝吃手是缺锌？”错！0-6个月吃手高峰背后，是大脑在疯狂升级	\N	\N	f	ai	t	2026-08-09 14:21:29.517	2026-08-09 14:21:29.517
cmslw52jx004ei5py7q908msg	母婴	title	对比	对比	暴雨天气宝宝易咳嗽？不是受凉，而是这2种室内环境隐患在作祟	\N	\N	f	ai	t	2026-08-09 14:21:29.517	2026-08-09 14:21:29.517
cmslw52jy004fi5py7mu7bz6y	母婴	title	对比	对比	海淀妈妈群疯传的《辅食添加红黑榜》，附检测报告截图	\N	\N	f	ai	t	2026-08-09 14:21:29.518	2026-08-09 14:21:29.518
cmslw52jz004gi5pywnqjjqfk	母婴	title	对比	对比	月嫂说‘抱睡不算坏习惯’”，但神经科医生指出：3个月后影响前庭发育	\N	\N	f	ai	t	2026-08-09 14:21:29.52	2026-08-09 14:21:29.52
cmslw52k0004hi5pybsuxv0iz	母婴	title	对比	对比	冬至进补别乱来！中医提醒：宝宝脾胃娇嫩，这4类膏方坚决不碰	\N	\N	f	ai	t	2026-08-09 14:21:29.52	2026-08-09 14:21:29.52
cmslw52k0004ii5pydz1bb0rf	母婴	title	对比	对比	宝宝睡偏头？别急纠姿，先判断是这3种原因里的哪一种	\N	\N	f	ai	t	2026-08-09 14:21:29.521	2026-08-09 14:21:29.521
cmslw52k2004ji5py8gu90j69	母婴	title	对比	对比	奶粉冲调水温70℃？错！”飞利浦联合中检院发布最新溶解活性报告	\N	\N	f	ai	t	2026-08-09 14:21:29.523	2026-08-09 14:21:29.523
cmslw52k4004ki5pyqgnxlo6e	母婴	title	对比	对比	产科病房里，那位总在凌晨3点翻手机的妈妈，后来做了这件事	\N	\N	f	ai	t	2026-08-09 14:21:29.524	2026-08-09 14:21:29.524
cmslw52k4004li5py7i6h91m9	母婴	title	对比	对比	宝宝抗拒刷牙？不是叛逆，是牙龈敏感期+电动牙刷震频不匹配	\N	\N	f	ai	t	2026-08-09 14:21:29.525	2026-08-09 14:21:29.525
cmslw52k5004mi5pyncmruljx	母婴	title	对比	对比	孩子走路晚=发育慢？”北大妇幼跟踪研究：16个月仍不走，只需观察这2项	\N	\N	f	ai	t	2026-08-09 14:21:29.525	2026-08-09 14:21:29.525
cmslw52k6004ni5py8m81gzyo	母婴	title	对比	对比	待产包清单更新版｜2024三甲产科护士手写批注（含医院自备物品标注）	\N	\N	f	ai	t	2026-08-09 14:21:29.526	2026-08-09 14:21:29.526
cmslw52k7004oi5py3hok4jfy	母婴	title	对比	对比	哺乳期吃辣回奶？”中山一院母乳库数据：辣椒素进入乳汁量≈0.003mg/L	\N	\N	f	ai	t	2026-08-09 14:21:29.527	2026-08-09 14:21:29.527
cmslw52k8004pi5pyv2k96uis	母婴	title	对比	对比	新冠XBB变种来袭，儿科医生紧急提醒：宝宝防护重点已从口罩转向这里	\N	\N	f	ai	t	2026-08-09 14:21:29.528	2026-08-09 14:21:29.528
cmslw52k8004qi5pymkw0kycn	母婴	title	对比	对比	产后脱发掉成片？别急吃黑芝麻，先查这2项激素+1个头皮微生态指标	\N	\N	f	ai	t	2026-08-09 14:21:29.529	2026-08-09 14:21:29.529
cmslw52k9004ri5pyekd80jtb	母婴	title	对比	对比	宝宝总抓耳朵，	\N	\N	f	ai	t	2026-08-09 14:21:29.529	2026-08-09 14:21:29.529
cmslw64is004si5pyyi2fag62	母婴	article	新客引流	\N	\N	新客引流：刚查出怀孕的姐妹别慌！我们免费送《孕早期安心指南》电子手册+1对1营养师15分钟咨询，扫码领→含叶酸补充时间表、早孕反应缓解法、产检时间节点提醒，全是三甲医院产科医生审核过的内容，不卖课不推销，只帮你稳稳迈出第一步。	\N	f	ai	t	2026-08-09 14:22:18.723	2026-08-09 14:22:18.723
cmslw64it004ti5py2p0ecf9s	母婴	article	老客复购	\N	\N	新客引流：带宝宝第一次来店？前台小姐姐会送你「新手爸妈体验包」：消毒湿巾试用装+棉柔巾小样+0-3月喂养节奏表，还能免费做一次婴儿皮肤pH值检测（仪器经省妇幼认证），真实数据比经验更靠谱。	\N	f	ai	t	2026-08-09 14:22:18.725	2026-08-09 14:22:18.725
cmslw64iu004ui5pykro1d55n	母婴	article	产品种草	\N	\N	新客引流：搜索“XX市母婴”还在比价格？不如比专业——预约首次到店，即可领取《本地三甲儿科医生推荐清单》+社区医院疫苗接种绿色通道指引，附赠我们自营药房「婴幼儿用药安全自查表」，纸质版现场可取。	\N	f	ai	t	2026-08-09 14:22:18.726	2026-08-09 14:22:18.726
cmslw64iw004vi5pyfxlfbsx7	母婴	article	客户见证	\N	\N	老客复购：上个月囤的婴儿润肤霜快见底了吧？现在回购享「空瓶换新」：带任意品牌空瓶（洗净）+本店任意消费满199元，立减30元，还送同系列旅行装（含SPF15物理防晒成分说明卡）。	\N	f	ai	t	2026-08-09 14:22:18.729	2026-08-09 14:22:18.729
cmslw64ix004wi5pyzqhvomwb	母婴	article	节假日活动	\N	\N	老客复购：您家宝宝6个月啦！系统自动为您推送「辅食进阶包」：含铁米粉试用装×2+自制辅食工具消毒指南+儿保医生录制的「舌系带自查视频」，下单即安排专属育儿顾问1v1跟进喂养反馈。	\N	f	ai	t	2026-08-09 14:22:18.729	2026-08-09 14:22:18.729
cmslw64ix004xi5py0645ufh7	母婴	article	品牌故事	\N	\N	老客复购：产后第8个月，盆底肌力测试显示恢复进度72%？恭喜！凭历史订单截图+近期体态评估照片，可免费升级1次「筋膜放松+凯格尔强化」组合课（原价298元），专业康复师全程记录变化。	\N	f	ai	t	2026-08-09 14:22:18.73	2026-08-09 14:22:18.73
cmslw64iy004yi5pyln1b3vzf	母婴	article	上新公告	\N	\N	产品种草：这款有机棉纱布巾不是“软”就完事了——它通过OEKO-TEX® Standard 100 Class I（婴幼儿级）认证，每批次都有SGS重金属残留报告，连染料都用植物萃取色素，洗50次后柔软度仍达国标A类要求。	\N	f	ai	t	2026-08-09 14:22:18.73	2026-08-09 14:22:18.73
cmslw64iy004zi5py3nhqnj6o	母婴	article	优惠活动	\N	\N	产品种草：别再用酒精棉片擦奶瓶了！我们的食品级硅胶刷套装，刷毛密度达2800根/平方厘米，缝隙清洁力提升3倍，手柄防滑纹路经1000位妈妈实测握持舒适度提升47%，还配可拆卸沥水架。	\N	f	ai	t	2026-08-09 14:22:18.731	2026-08-09 14:22:18.731
cmslw64iz0050i5pyi7hvkej1	母婴	article	知识科普	\N	\N	产品种草：看到“益生菌”就心动？先看这3个关键点：菌株号必须标注（如BB-12®）、活菌数≥10⁸CFU/袋、需冷藏运输（我们全程冷链+温控物流单可查）。现在下单附赠《宝宝肠道信号自查图》。	\N	f	ai	t	2026-08-09 14:22:18.731	2026-08-09 14:22:18.731
cmslw64iz0051i5py4z4semhw	母婴	article	互动话题	\N	\N	客户见证：杭州宝妈@悠悠妈：“娃湿疹反复3个月，换了6种霜都没用。顾问老师让我停用所有‘修复’产品，只用你们的弱酸性舒缓膏+拍视频记录皮损变化，21天结痂脱屑，现在全家用同一款。	\N	f	ai	t	2026-08-09 14:22:18.732	2026-08-09 14:22:18.732
cmslw64j00052i5pyuznffe8t	母婴	article	答疑辟谣	\N	\N	客户见证：“月嫂面试被放鸽子3次？我们匹配的李姐带证上岗8年，有新生儿窒息复苏证书+母乳喂养指导师资质，入住当天就教我识别宝宝饥饿微表情，现在娃夜醒少、体重增长曲线稳稳在P50。	\N	f	ai	t	2026-08-09 14:22:18.732	2026-08-09 14:22:18.732
cmslw64j00053i5pymuljmylf	母婴	article	会员权益	\N	\N	客户见证：产后抑郁筛查阳性后不敢告诉家人？在我们心理咨询室做完6次CBT干预，配合运动处方和光照日记，3个月后SDQ量表从22分降到8分，现在她成了社群里的「情绪树洞志愿者」。	\N	f	ai	t	2026-08-09 14:22:18.733	2026-08-09 14:22:18.733
cmslw64j10054i5pyyw7hqynr	母婴	article	会员权益	\N	\N	节假日活动：端午节不做香囊DIY！我们请浙大儿院中医科医生直播讲「儿童夏季脾胃养护」，现场抽10位妈妈送定制艾草暖脐贴（含无纺布基材检测报告），留言“端午安康”还能领电子版《节气育儿日历》。	\N	f	ai	t	2026-08-09 14:22:18.734	2026-08-09 14:22:18.734
cmslw64j20055i5pyp11ojppm	母婴	article	会员权益	\N	\N	节假日活动：中秋带娃回老家怕水土不服？到店领「旅途安心包」：便携电解质粉（钠钾氯配比按WHO标准）、折叠硅胶奶瓶刷、可降解湿巾（含金盏花提取物），加赠《高铁车厢哺乳友好座位地图》PDF。	\N	f	ai	t	2026-08-09 14:22:18.734	2026-08-09 14:22:18.734
cmslw64j20056i5pyz4klbipd	母婴	article	会员权益	\N	\N	节假日活动：春节不囤尿不湿！参与「新年成长存钱罐」活动：每存100元服务金，系统自动生成宝宝身高体重趋势图，除夕夜解锁专属语音祝福（由您上传录音+AI合成宝宝笑声背景音）。	\N	f	ai	t	2026-08-09 14:22:18.735	2026-08-09 14:22:18.735
cmslw64j30057i5py425751fw	母婴	article	会员权益	\N	\N	品牌故事：2015年创始人产检时发现，B超单背面印着“建议自费购买某品牌奶粉”，却没人告诉她：配方奶中DHA来源是藻油还是鱼油、是否含棕榈酸酯——那晚她决定辞职，和两位儿科护士一起建起这家“只说清楚成分”的母婴中心。	\N	f	ai	t	2026-08-09 14:22:18.735	2026-08-09 14:22:18.735
cmslw64j30058i5pyymc43ofr	母婴	article	会员权益	\N	\N	品牌故事：我们的康复师团队里，有3位是产伤康复受益者：有人产后漏尿2年不敢跳绳，有人耻骨联合分离靠拐杖走路……现在她们每天帮其他妈妈做评估，所有方案都标注“本人亲身验证周期”。	\N	f	ai	t	2026-08-09 14:22:18.736	2026-08-09 14:22:18.736
cmslw64j40059i5py8xi5v1mm	母婴	article	会员权益	\N	\N	品牌故事：药房货架上每盒钙剂旁，都贴着一张手写卡片：“2022.3.17，王医生建议张女士改用柠檬酸钙——因她正服奥美拉唑，碳酸钙会影响吸收”。这不是营销，是我们坚持11年的处方级服务细节。	\N	f	ai	t	2026-08-09 14:22:18.736	2026-08-09 14:22:18.736
cmslw64j5005ai5pys74vtudr	母婴	article	会员权益	\N	\N	上新公告：全新「胎心监护居家套装」上线！含FDA认证蓝牙多普勒仪+APP智能分析（识别宫缩规律/胎动响应延迟），支持远程共享给产科医生，配套赠送《异常波形对照图册》（附三甲医院产科主任手写批注页）。	\N	f	ai	t	2026-08-09 14:22:18.737	2026-08-09 14:22:18.737
cmslw64j5005bi5pyrwqf6j2o	母婴	article	会员权益	\N	\N	上新公告：托育班新增「感官雨林角」：墙面用德国进口声学软包（隔音系数≥35dB），地垫通过EN71-3重金属迁移测试，连悬挂的摇铃都做了0.5m坠落冲击试验，视频可查第三方检测全过程。	\N	f	ai	t	2026-08-09 14:22:18.738	2026-08-09 14:22:18.738
cmslw64j6005ci5pyv1er8j1e	母婴	article	会员权益	\N	\N	上新公告：孕晚期专用「分娩球升级版」来了！加厚防爆层（承重200kg）、双密度内胆（坐感适配不同腰椎曲度）、表面纳米疏水涂层（血渍一擦即净），首批用户享免费上门充气调试服务。	\N	f	ai	t	2026-08-09 14:22:18.738	2026-08-09 14:22:18.738
cmslw64j6005di5pyl1oh6gi7	母婴	article	会员权益	\N	\N	优惠活动：618不玩满减！全场母婴用品「买即赠使用周期表」：比如纸尿裤赠《NB-M码精准切换指南》，哺乳内衣赠《乳腺管走向示意图+穿戴角度教学视频》，知识比折扣更值。	\N	f	ai	t	2026-08-09 14:22:18.739	2026-08-09 14:22:18.739
cmslw64j8005ei5pykuicpxoa	母婴	article	会员权益	\N	\N	优惠活动：教师节专享：出示教师资格证，所有产后康复项目打7折，并赠《0-3岁儿童语言发育里程碑自查手册》（含普通话/方言双版本发音示范音频）。	\N	f	ai	t	2026-08-09 14:22:18.74	2026-08-09 14:22:18.74
cmslw64j8005fi5pyrh2cgj39	母婴	article	会员权益	\N	\N	优惠活动：开学季「托育体验周」开放预约：9月1-7日每日限15组家庭，含晨检AI体温筛查演示、蒙氏教具操作指导、营养师现场测算宝宝当日铁摄入缺口，全程录像可回看。	\N	f	ai	t	2026-08-09 14:22:18.741	2026-08-09 14:22:18.741
cmslw64j9005gi5pygek9czty	母婴	article	会员权益	\N	\N	知识科普：宝宝吐奶≠胃食管反流！真正需要干预的信号是：喷射状呕吐+体重增长＜每月300g+哭闹时弓背拒奶。我们整理了浙大儿院消化科最新分型处理流程图，到店可领纸质版。	\N	f	ai	t	2026-08-09 14:22:18.741	2026-08-09 14:22:18.741
cmslw64ja005hi5pyyg1o4v30	母婴	article	会员权益	\N	\N	知识科普：DHA补充不是越多越好！0-2岁宝宝每日上限200mg，过量可能影响免疫平衡。我们对比了市面27款DHA滴剂，发现12款实际含量超标，附检测报告二维码，扫码即看实验室原始数据。	\N	f	ai	t	2026-08-09 14:22:18.742	2026-08-09 14:22:18.742
cmslw64ja005ii5py4jjpkef6	母婴	article	会员权益	\N	\N	知识科普：所谓“婴儿定型枕”纯属智商税！美国儿科学会（AAP）明确：1岁前枕头增加窒息风险。我们用3D压力传感垫实测：平躺时头颈压力分布最均衡，所有“塑形枕”反而造成局部压强升高300%。	\N	f	ai	t	2026-08-09 14:22:18.743	2026-08-09 14:22:18.743
cmslw64jb005ji5py1kxyv93a	母婴	article	会员权益	\N	\N	互动话题：你家宝宝第一个“社会性微笑”出现在第几天？评论区晒照片+周龄，抽3位送《新生儿微笑发育追踪手账》（含行为解读+拍摄技巧），我们请儿童心理师逐条回复发育意义。	\N	f	ai	t	2026-08-09 14:22:18.743	2026-08-09 14:22:18.743
cmslw64jc005ki5pyye0pzqnk	母婴	article	会员权益	\N	\N	互动话题：产后最想扔掉的3样东西是什么？是束腹带？是没用过的吸奶器？还是那本越看越焦虑的《育儿百科》？留言告诉我们，下周直播邀请临床心理科主任聊聊“减法养育”。	\N	f	ai	t	2026-08-09 14:22:18.744	2026-08-09 14:22:18.744
cmslw64jd005li5py7qulfzwy	母婴	article	会员权益	\N	\N	互动话题：如果给宝宝设计一句“人生第一句广告语”，你会怎么写？比如“我喝奶，但不认品牌”“我翻身，但不care月龄”……优质留言将印在下季度会员卡背面，署名+宝宝小名。	\N	f	ai	t	2026-08-09 14:22:18.745	2026-08-09 14:22:18.745
cmslw64je005mi5pypx16el7y	母婴	article	会员权益	\N	\N	答疑辟谣：羊水穿刺≠流产风险高！我院合作产前诊断中心数据显示：熟练医师操作下，流产率仅0.13%（低于自然流产率），且能同步检测100+种单基因病，远超无创DNA覆盖范围。	\N	f	ai	t	2026-08-09 14:22:18.746	2026-08-09 14:22:18.746
cmslw64je005ni5pyngk8c3tl	母婴	article	会员权益	\N	\N	答疑辟谣：“母乳性黄疸要停喂3天”是严重误区！浙大儿院黄疸门诊证实：持续母乳喂养+光疗才是金标准，停喂反而导致脱水加重胆红素肠肝循环。我们整理了《黄疸照护实操清单》。	\N	f	ai	t	2026-08-09 14:22:18.747	2026-08-09 14:22:18.747
cmslw64jf005oi5pychrmy5iu	母婴	article	会员权益	\N	\N	答疑辟谣：婴儿游泳馆水温33℃才安全？错！中国妇幼保健协会指南明确：37-38℃为最佳区间（接近体温），低于35℃易引发应激反应，我们恒温系统每日校准记录公开可查。	\N	f	ai	t	2026-08-09 14:22:18.748	2026-08-09 14:22:18.748
cmslw64jg005pi5pyyrq4390j	母婴	article	会员权益	\N	\N	会员权益：银卡会员生日当月，可预约「产康师上门体态快检」（含骨盆前倾/圆肩/腹直肌分离3项基础评估），报告同步推送至您的家庭医生端口，支持医保个账支付。	\N	f	ai	t	2026-08-09 14:22:18.749	2026-08-09 14:22:18.749
cmslw64jh005qi5pyr8uaoj02	母婴	article	会员权益	\N	\N	会员权益：金卡会员享「药品直送绿色通道」：在我们药房下单的维生素D3、铁剂等处方级营养品，48小时内顺丰冷链直达，包裹内置温感标签，手机实时查看运输温度曲线。	\N	f	ai	t	2026-08-09 14:22:18.749	2026-08-09 14:22:18.749
cmslw64jh005ri5pygvgyvn5l	母婴	article	会员权益	\N	\N	会员权益：黑金会员独享「成长档案云同步」：每次儿保体检数据、疫苗接种记录、发育筛查结果自动归档，生成年度《养育健康白皮书》，支持一键导出提交幼儿园/小学入学材料。	\N	f	ai	t	2026-08-09 14:22:18.75	2026-08-09 14:22:18.75
cmslw6hy5005si5py455zvv98	母婴	topic	\N	\N	春天过敏高发期，宝宝湿疹反复？这5种成分妈妈一定要避开	\N	\N	f	ai	t	2026-08-09 14:22:36.125	2026-08-09 14:22:36.125
cmslw6hy7005ti5pynaof35v6	母婴	topic	\N	\N	3·15曝光后，婴儿洗护产品「安全线」到底在哪？我们查了27份检测报告	\N	\N	f	ai	t	2026-08-09 14:22:36.128	2026-08-09 14:22:36.128
cmslw6hy9005ui5pypde7no4w	母婴	topic	\N	\N	孕晚期失眠怎么办？产科医生亲授4个不喝安眠药的助眠法	\N	\N	f	ai	t	2026-08-09 14:22:36.13	2026-08-09 14:22:36.13
cmslw6hya005vi5py5yj6kg18	母婴	topic	\N	\N	清明踏青带娃指南：0-3岁宝宝防晒/防虫/便携装备清单（附实测品牌）	\N	\N	f	ai	t	2026-08-09 14:22:36.131	2026-08-09 14:22:36.131
cmslw6hyc005wi5pyac2lzbpr	母婴	topic	\N	\N	世界自闭症关注日｜宝宝语言发育迟缓的6个早期信号（不是“贵人语迟”）	\N	\N	f	ai	t	2026-08-09 14:22:36.132	2026-08-09 14:22:36.132
cmslw6hyd005xi5pyzsmn4bt6	母婴	topic	\N	\N	五一出游避坑指南：亲子酒店怎么选？看这3个隐藏资质就够了	\N	\N	f	ai	t	2026-08-09 14:22:36.134	2026-08-09 14:22:36.134
cmslw6hyf005yi5pybvdrsllf	母婴	topic	\N	\N	儿童防晒霜测评更新｜SPF50+≠更安全！儿科皮肤科医生划重点	\N	\N	f	ai	t	2026-08-09 14:22:36.135	2026-08-09 14:22:36.135
cmslw6hyg005zi5pyl8mx5a8d	母婴	topic	\N	\N	高考季临近，孕妈情绪管理课：焦虑会传给宝宝吗？胎心监护数据告诉你真相	\N	\N	f	ai	t	2026-08-09 14:22:36.136	2026-08-09 14:22:36.136
cmslw6hyh0060i5py3r23lcgl	母婴	topic	\N	\N	六一特别策划：0-6岁分龄玩具红黑榜｜卫健委认证安全标准对照表	\N	\N	f	ai	t	2026-08-09 14:22:36.137	2026-08-09 14:22:36.137
cmslw6hyi0061i5py1x0j3w4b	母婴	topic	\N	\N	梅雨季来临，婴儿床褥霉菌超标3倍？教你用紫外线灯+湿度计自检	\N	\N	f	ai	t	2026-08-09 14:22:36.138	2026-08-09 14:22:36.138
cmslw6hyj0062i5pyql3ez2sj	母婴	topic	\N	\N	端午节传统育儿误区：给小月龄宝宝戴香囊、涂雄黄酒真的安全吗？	\N	\N	f	ai	t	2026-08-09 14:22:36.139	2026-08-09 14:22:36.139
cmslw6hyk0063i5py90cqlxm6	母婴	topic	\N	\N	暑期托育班怎么选？实地暗访8家机构后，我们总结出5条「保命条款」	\N	\N	f	ai	t	2026-08-09 14:22:36.14	2026-08-09 14:22:36.14
cmslw6hyl0064i5pyt70mhod0	母婴	topic	\N	\N	三伏天坐月子新解：中医+现代产科双视角，空调/洗澡/进补全说清	\N	\N	f	ai	t	2026-08-09 14:22:36.141	2026-08-09 14:22:36.141
cmslw6hyl0065i5pyiizbxc80	母婴	topic	\N	\N	开学季焦虑提前预警：2岁+分离焦虑应对方案（附3周渐进式训练表）	\N	\N	f	ai	t	2026-08-09 14:22:36.142	2026-08-09 14:22:36.142
cmslw6hym0066i5py6gj1tfto	母婴	topic	\N	\N	教师节致敬｜产科护士长的10年笔记：新生儿黄疸、脐炎、鹅口疮最易踩的3个坑	\N	\N	f	ai	t	2026-08-09 14:22:36.143	2026-08-09 14:22:36.143
cmslw6hyn0067i5pyq1qtyeos	母婴	topic	\N	\N	秋燥来袭，宝宝鼻塞干咳不用急！家庭雾化vs生理盐水喷雾实测对比	\N	\N	f	ai	t	2026-08-09 14:22:36.143	2026-08-09 14:22:36.143
cmslw6hyo0068i5pym1qpxv0b	母婴	topic	\N	\N	国庆亲子自驾必备：儿童安全座椅安装自查清单（90%家长都漏了第4步）	\N	\N	f	ai	t	2026-08-09 14:22:36.144	2026-08-09 14:22:36.144
cmslw6hyo0069i5pyxu1t3qq5	母婴	topic	\N	\N	重阳节特辑：新手爸妈如何给产后妈妈做「科学月子餐」？营养师配了7天食谱	\N	\N	f	ai	t	2026-08-09 14:22:36.145	2026-08-09 14:22:36.145
cmslw6hyp006ai5py9bbcurey	母婴	topic	\N	\N	双11前置科普：婴儿纸尿裤不是越贵越好！看懂这4个国标编号才不会被割韭菜	\N	\N	f	ai	t	2026-08-09 14:22:36.146	2026-08-09 14:22:36.146
cmslw6hyq006bi5pyjz8vdyzj	母婴	topic	\N	\N	立冬进补误区：哺乳期妈妈喝猪蹄汤真下奶？乳腺科医生列出促泌乳真实证据链	\N	\N	f	ai	t	2026-08-09 14:22:36.146	2026-08-09 14:22:36.146
cmslw6hyq006ci5pyob1a9gpi	母婴	topic	\N	\N	小雪节气后，婴儿室内加湿器使用红线：湿度＞60%反而诱发尘螨过敏	\N	\N	f	ai	t	2026-08-09 14:22:36.147	2026-08-09 14:22:36.147
cmslw6hyr006di5pyqs8vccer	母婴	topic	\N	\N	圣诞节亲子手工安全指南：0-3岁宝宝可用的无毒胶水&颜料认证清单	\N	\N	f	ai	t	2026-08-09 14:22:36.148	2026-08-09 14:22:36.148
cmslw6hys006ei5py9zclt8i7	母婴	topic	\N	\N	元旦焕新计划：母婴家庭年度健康体检清单（从孕检到入园体检全覆盖）	\N	\N	f	ai	t	2026-08-09 14:22:36.148	2026-08-09 14:22:36.148
cmslw6hyt006fi5pyjsriqiyn	母婴	topic	\N	\N	春节囤货避雷：婴幼儿辅食添加期，这6类「网红零食」建议直接拉黑	\N	\N	f	ai	t	2026-08-09 14:22:36.149	2026-08-09 14:22:36.149
cmslw6hyt006gi5py2kr88o8p	母婴	topic	\N	\N	情人节特别企划：产后夫妻亲密关系重建指南｜心理咨询师+产科医生联合答疑	\N	\N	f	ai	t	2026-08-09 14:22:36.15	2026-08-09 14:22:36.15
cmslw6hyu006hi5py4dggk0r7	母婴	topic	\N	\N	雨水节气养生：备孕妈妈调理体质的3个食疗方（附中医体质测试二维码）	\N	\N	f	ai	t	2026-08-09 14:22:36.151	2026-08-09 14:22:36.151
cmslw6hyv006ii5pyv47rozrf	母婴	topic	\N	\N	3·8妇女节专题：产后盆底肌修复不是「忍忍就好」！三甲康复科公开筛查标准	\N	\N	f	ai	t	2026-08-09 14:22:36.151	2026-08-09 14:22:36.151
cmslw6hyw006ji5py2mz9oeta	母婴	topic	\N	\N	世界早产儿日｜早产宝宝出院回家后，家长必须掌握的5项居家照护技能	\N	\N	f	ai	t	2026-08-09 14:22:36.152	2026-08-09 14:22:36.152
cmslw6hyx006ki5pyr5xes2d4	母婴	topic	\N	\N	冬至进补提醒：月子中心「古法膏方」靠谱吗？查了药监局备案号才敢说	\N	\N	f	ai	t	2026-08-09 14:22:36.153	2026-08-09 14:22:36.153
cmslw6hyx006li5py8wjm1qlt	母婴	topic	\N	\N	寒假托育需求暴增，我们扒出本地5家合规托育园的「教保人员持证率」真实数据	\N	\N	f	ai	t	2026-08-09 14:22:36.154	2026-08-09 14:22:36.154
cmslw6z2x006mi5py7qk52u3p	母婴	image_prompt	\N	\N	\N	一张ins风高清摄影图：柔光木质托盘上摆放三款有机棉婴儿连体衣（浅雾蓝/燕麦白/淡樱粉），背景为亚麻布与散落的尤加利叶，自然光从左上角洒下，画面干净温暖有呼吸感	\N	f	ai	t	2026-08-09 14:22:58.329	2026-08-09 14:22:58.329
cmslw6z2z006ni5pyg5jb43yt	母婴	image_prompt	\N	\N	\N	一张写实风格高清图：母婴门店内景实拍视角，明亮通透的落地窗、原木色货架整齐陈列通过欧盟OEKO-TEX认证的纸尿裤与湿巾，店员穿浅灰围裙微笑整理货品，一位妈妈正低头查看产品成分表	\N	f	ai	t	2026-08-09 14:22:58.332	2026-08-09 14:22:58.332
cmslw6z31006oi5pyvdhh0c4d	母婴	image_prompt	\N	\N	\N	一张国潮风格插画图：水墨晕染底纹上跃动三只Q版瑞兽（麒麟抱奶瓶、锦鲤衔安抚巾、仙鹤衔温奶器），配金色祥云边框与“安心守育”书法字，整体配色为朱砂红+竹青+月白	\N	f	ai	t	2026-08-09 14:22:58.333	2026-08-09 14:22:58.333
cmslw6z32006pi5pytymas8pw	母婴	image_prompt	\N	\N	\N	一张ins风高清摄影图：阳光漫射的温馨门店前台，原木接待台摆着绿植与手写欢迎卡，背景墙是浅灰微水泥材质，嵌入品牌LOGO与“持证育婴师驻店”金属铭牌，光影柔和有生活温度	\N	f	ai	t	2026-08-09 14:22:58.335	2026-08-09 14:22:58.335
cmslw6z34006qi5pypgeyrsbu	母婴	image_prompt	\N	\N	\N	一张写实风格高清图：真实母婴护理中心实景，宽敞明亮的产后康复区，两位穿藏青制服的专业理疗师正为一位产后妈妈做腹直肌评估，设备含德国PHENIX肌电仪与定制骨盆带，环境整洁有序	\N	f	ai	t	2026-08-09 14:22:58.336	2026-08-09 14:22:58.336
cmslw6z35006ri5pyhckhfem6	母婴	image_prompt	\N	\N	\N	一张国潮风格插画图：青绿山水长卷式构图，左侧古法蒸熏桶旁坐执扇妈妈，中部现代智能温奶器与中药包并置，右侧卡通药师爷爷递出“科学坐月子指南”，题跋印章为“粤省妇幼推荐	\N	f	ai	t	2026-08-09 14:22:58.337	2026-08-09 14:22:58.337
cmslw6z36006si5pythb735uv	母婴	image_prompt	\N	\N	\N	一张ins风高清摄影图：春季亲子手作活动海报主视觉，浅杏色背景上悬浮水彩质感的樱花枝，枝头挂三枚手绘小物——布艺小兔子、拓印围兜、植物染手帕，右下角手写字体“4.13 周六 · 棉柔手作日	\N	f	ai	t	2026-08-09 14:22:58.338	2026-08-09 14:22:58.338
cmslw6z37006ti5pylnra714f	母婴	image_prompt	\N	\N	\N	一张写实风格高清图：门店真实举办的“0-3月龄抚触课”现场，6组家庭围坐浅灰地毯，专业讲师跪坐示范动作，宝宝们裹在纯棉襁褓中，镜头捕捉妈妈轻抚宝宝背部的专注侧脸	\N	f	ai	t	2026-08-09 14:22:58.339	2026-08-09 14:22:58.339
cmslw7jet007ti5pyqdgsuozt	本地生活	title	对比	对比	宠物店老板亲测：这台烘干机温度恒定42℃，比我家烤箱还准	\N	\N	f	ai	t	2026-08-09 14:23:24.677	2026-08-09 14:23:24.677
cmslw6z38006ui5pygb2mwt83	母婴	image_prompt	\N	\N	\N	一张国潮风格插画图：喜庆宫灯造型活动海报，灯面绘十二生肖宝宝剪影围坐听故事，灯穗垂落处写“六一·国风育婴游园会”，灯笼下方展开卷轴，列“非遗香囊DIY”“节气食养小灶台”等手绘图标	\N	f	ai	t	2026-08-09 14:22:58.34	2026-08-09 14:22:58.34
cmslw6z39006vi5pyu3kdv1wj	母婴	image_prompt	\N	\N	\N	一张ins风高清摄影图：真实妈妈客户案例图，30岁左右短发妈妈穿米白针织衫坐在家中飘窗，膝上摊开《0-6月睡眠引导手册》，身旁熟睡宝宝盖着同色系有机棉小被，窗外天光微蓝	\N	f	ai	t	2026-08-09 14:22:58.341	2026-08-09 14:22:58.341
cmslw6z3a006wi5pyy8053flk	母婴	image_prompt	\N	\N	\N	一张写实风格高清图：产后修复客户对比图（同一人术前术后12周），非医美修图，仅展示体态变化：站姿更挺拔、腹肌线条初现，背景为机构训练室镜面墙，镜中可见教练指导手势	\N	f	ai	t	2026-08-09 14:22:58.342	2026-08-09 14:22:58.342
cmslw6z3b006xi5pyh11lnhb7	母婴	image_prompt	\N	\N	\N	一张国潮风格插画图：水墨人物长卷式客户故事，三位不同年龄段妈妈形象并置——哺乳期妈妈捧陶碗饮药膳汤、职场妈妈用智能背奶包赶地铁、二胎妈妈牵两娃走过“成长阶梯”浮雕墙，题“她力量·稳稳的成长	\N	f	ai	t	2026-08-09 14:22:58.343	2026-08-09 14:22:58.343
cmslw6z3c006yi5pya5nti3ye	母婴	image_prompt	\N	\N	\N	一张ins风高清摄影图：冬日母婴空间氛围图，暖光落地灯旁堆叠毛绒绘本与羊绒盖毯，玻璃罐里装着自制婴儿润肤膏（标签手写“山茶籽油+乳木果”），窗上凝着细密水雾，映出窗外微雪	\N	f	ai	t	2026-08-09 14:22:58.344	2026-08-09 14:22:58.344
cmslw6z3e006zi5py6jm5hk9n	母婴	image_prompt	\N	\N	\N	一张写实风格高清图：深夜门店值班实景，暖黄壁灯下，持证月嫂正俯身检查熟睡宝宝呼吸节奏，床头柜放电子体温计与手写喂养记录本，背景可见“24H远程监护系统”指示灯微亮	\N	f	ai	t	2026-08-09 14:22:58.346	2026-08-09 14:22:58.346
cmslw6z3f0070i5pya49jzmic	母婴	image_prompt	\N	\N	\N	一张国潮风格插画图：节气主题母婴日常图，立夏时节青瓦白墙院中，竹编摇篮里宝宝酣睡，石桌上摆凉茶包与手作艾草香囊，檐角悬“稚子安夏”篆书灯笼，飞鸟掠过水墨云纹天空	\N	f	ai	t	2026-08-09 14:22:58.347	2026-08-09 14:22:58.347
cmslw7je10071i5pyleeohime	本地生活	title	数字	数字	3个保洁阿姨上门后，我家地板反光到能照出人影	\N	\N	f	ai	t	2026-08-09 14:23:24.649	2026-08-09 14:23:24.649
cmslw7je40072i5py3g4acmrw	本地生活	title	反差	反差	7天内免费重做！我们敢签这份保洁服务承诺书	\N	\N	f	ai	t	2026-08-09 14:23:24.652	2026-08-09 14:23:24.652
cmslw7je50073i5py65n8th4h	本地生活	title	疑问	疑问	92%的客户说：这次维修师傅比自家亲戚还靠谱	\N	\N	f	ai	t	2026-08-09 14:23:24.653	2026-08-09 14:23:24.653
cmslw7je60074i5pypfu7j7cm	本地生活	title	痛点	痛点	5分钟搞定漏水检测，不拆墙不砸砖，立等出报告	\N	\N	f	ai	t	2026-08-09 14:23:24.654	2026-08-09 14:23:24.654
cmslw7je70075i5pyh970ye1s	本地生活	title	福利	福利	1次深度洗护=省下3年宠物皮肤药费，养猫家庭已囤卡	\N	\N	f	ai	t	2026-08-09 14:23:24.655	2026-08-09 14:23:24.655
cmslw7je80076i5py560em2gg	本地生活	title	权威数据	权威数据	保洁前 vs 保洁后：同一间出租屋，房东看完当场涨租200	\N	\N	f	ai	t	2026-08-09 14:23:24.656	2026-08-09 14:23:24.656
cmslw7je90077i5pyg9mdwup6	本地生活	title	悬念	悬念	师傅穿鞋套+戴口罩+工具全消毒，你家厨房比我家还干净	\N	\N	f	ai	t	2026-08-09 14:23:24.658	2026-08-09 14:23:24.658
cmslw7jea0078i5pyfmnfh3dr	本地生活	title	共情	共情	为什么邻居王姐连续3年只找我们修空调？真相在这张工单里	\N	\N	f	ai	t	2026-08-09 14:23:24.658	2026-08-09 14:23:24.658
cmslw7jeb0079i5pynhbu1ct0	本地生活	title	故事	故事	“上次换水管花了2800，这次才收398”——李叔发来的收款截图	\N	\N	f	ai	t	2026-08-09 14:23:24.659	2026-08-09 14:23:24.659
cmslw7jec007ai5pyok7cbfr1	本地生活	title	清单	清单	深夜11点接到报修电话，23:47师傅已蹲在您家厨房换角阀	\N	\N	f	ai	t	2026-08-09 14:23:24.66	2026-08-09 14:23:24.66
cmslw7jed007bi5pynm3aa3ey	本地生活	title	热点	热点	家政阿姨带娃做饭擦玻璃，全程录像可回看，放心出门一整天	\N	\N	f	ai	t	2026-08-09 14:23:24.661	2026-08-09 14:23:24.661
cmslw7jee007ci5pycsrytw3x	本地生活	title	对比	对比	保洁阿姨用pH试纸测清洁剂，数值5.8——和婴儿洗发水一样温和	\N	\N	f	ai	t	2026-08-09 14:23:24.662	2026-08-09 14:23:24.662
cmslw7jee007di5pyee48s76b	本地生活	title	对比	对比	你家油烟机三年没洗？拆开那一刻，连师傅都愣住了…	\N	\N	f	ai	t	2026-08-09 14:23:24.663	2026-08-09 14:23:24.663
cmslw7jef007ei5pycz53ovu1	本地生活	title	对比	对比	洗地毯时发现猫毛缠成团？我们顺手做了过敏原消杀	\N	\N	f	ai	t	2026-08-09 14:23:24.664	2026-08-09 14:23:24.664
cmslw7jeg007fi5py0mul24we	本地生活	title	对比	对比	修完热水器，师傅把旧零件装进密封袋，贴上标签交您手上	\N	\N	f	ai	t	2026-08-09 14:23:24.664	2026-08-09 14:23:24.664
cmslw7jeh007gi5py829xo79e	本地生活	title	对比	对比	“你们真敢按小时收费？”——试过一次，客户自己改了计费方式	\N	\N	f	ai	t	2026-08-09 14:23:24.665	2026-08-09 14:23:24.665
cmslw7jei007hi5pyekj9bt7t	本地生活	title	对比	对比	3年0投诉！全市276位物业经理联名推荐的维修团队	\N	\N	f	ai	t	2026-08-09 14:23:24.666	2026-08-09 14:23:24.666
cmslw7jej007ii5pyufg7capa	本地生活	title	对比	对比	上周暴雨后，我们帮142户家庭抢修漏水，最快42分钟上门	\N	\N	f	ai	t	2026-08-09 14:23:24.667	2026-08-09 14:23:24.667
cmslw7jej007ji5pypvv0hmwm	本地生活	title	对比	对比	师傅工具包里有5种胶、7把扳手、1台红外测漏仪——不是来凑数的	\N	\N	f	ai	t	2026-08-09 14:23:24.668	2026-08-09 14:23:24.668
cmslw7jek007ki5pyicc9xpy9	本地生活	title	对比	对比	保洁完顺手帮老人调好燃气灶风门，还留了张手写操作卡	\N	\N	f	ai	t	2026-08-09 14:23:24.669	2026-08-09 14:23:24.669
cmslw7jel007li5py2fv7yhim	本地生活	title	对比	对比	为什么95后小夫妻宁愿多花50块，也要约这个洗车师傅？	\N	\N	f	ai	t	2026-08-09 14:23:24.67	2026-08-09 14:23:24.67
cmslw7jem007mi5py2q513u3g	本地生活	title	对比	对比	阿姨边擦窗边教孩子叠毛巾：“你看，这样干得快还不留水痕”	\N	\N	f	ai	t	2026-08-09 14:23:24.671	2026-08-09 14:23:24.671
cmslw7jen007ni5pyxd23iktx	本地生活	title	对比	对比	修马桶不换件？师傅掏出超声波清洗器，堵了3年的U型管通了	\N	\N	f	ai	t	2026-08-09 14:23:24.672	2026-08-09 14:23:24.672
cmslw7jeo007oi5pyj9wr1z0i	本地生活	title	对比	对比	3年前下单的包年保洁，今天续费时她递来一盒手工皂	\N	\N	f	ai	t	2026-08-09 14:23:24.672	2026-08-09 14:23:24.672
cmslw7jep007pi5pyp5d8lbru	本地生活	title	对比	对比	保洁前拍视频存档，做完再拍一遍——差哪处，我们赔双倍	\N	\N	f	ai	t	2026-08-09 14:23:24.673	2026-08-09 14:23:24.673
cmslw7jeq007qi5py19xs7wp2	本地生活	title	对比	对比	同样换锁芯，别人报价480，我们亮出五金城批发单：材料198	\N	\N	f	ai	t	2026-08-09 14:23:24.674	2026-08-09 14:23:24.674
cmslw7jer007ri5py7g5rc9au	本地生活	title	对比	对比	师傅进门先铺防污垫，工具摆成直线，走时地面无一丝划痕	\N	\N	f	ai	t	2026-08-09 14:23:24.675	2026-08-09 14:23:24.675
cmslw7jes007si5pybcsklkoy	本地生活	title	对比	对比	“你们连纱窗都拆下来洗？”——客户拍下晾在阳台的8扇净纱窗	\N	\N	f	ai	t	2026-08-09 14:23:24.676	2026-08-09 14:23:24.676
cmslw7jet007ui5pys78aypit	本地生活	title	对比	对比	修完电路，师傅手绘一张“开关对应图”，贴在配电箱盖内侧	\N	\N	f	ai	t	2026-08-09 14:23:24.678	2026-08-09 14:23:24.678
cmslw7jeu007vi5pyrv5uhn17	本地生活	title	对比	对比	昨晚台风预警，我们提前给老小区23栋楼检查了阳台排水口	\N	\N	f	ai	t	2026-08-09 14:23:24.679	2026-08-09 14:23:24.679
cmslw7jev007wi5pyj2peb3yh	本地生活	title	对比	对比	保洁阿姨自带除螨仪，吸出的尘螨堆成小山，客户拍照发朋友圈	\N	\N	f	ai	t	2026-08-09 14:23:24.68	2026-08-09 14:23:24.68
cmslw7jew007xi5pyx14t33cz	本地生活	title	对比	对比	“上次被坑了800，这次你们报价单连胶水型号都写了”	\N	\N	f	ai	t	2026-08-09 14:23:24.681	2026-08-09 14:23:24.681
cmslw7jex007yi5pyubvkanuf	本地生活	title	对比	对比	师傅用激光水平仪调柜门，误差≤0.3mm，业主拿尺子量了三次	\N	\N	f	ai	t	2026-08-09 14:23:24.682	2026-08-09 14:23:24.682
cmslw7jey007zi5pyneq5vt3r	本地生活	title	对比	对比	深夜宠物呕吐，我们20分钟上门清污+除味+紫外线消杀	\N	\N	f	ai	t	2026-08-09 14:23:24.683	2026-08-09 14:23:24.683
cmslw7jez0080i5py7y2n22w7	本地生活	title	对比	对比	3年复购率81%！数据来自真实订单系统，非问卷虚构	\N	\N	f	ai	t	2026-08-09 14:23:24.683	2026-08-09 14:23:24.683
cmslw7jf00081i5pymdmt1r0d	本地生活	title	对比	对比	空调清洗前后PM2.5对比：开机1小时，从126降到12	\N	\N	f	ai	t	2026-08-09 14:23:24.684	2026-08-09 14:23:24.684
cmslw7jf10082i5py68o7kt8j	本地生活	title	对比	对比	保洁完顺手帮独居奶奶把药盒分好周剂量，还标了服药时间	\N	\N	f	ai	t	2026-08-09 14:23:24.685	2026-08-09 14:23:24.685
cmslw7jf20083i5py19l8c3w3	本地生活	title	对比	对比	“你们真把旧洗衣机拉走了？”——师傅扫码登记后，给了回收凭证	\N	\N	f	ai	t	2026-08-09 14:23:24.686	2026-08-09 14:23:24.686
cmslw7jf30084i5pyj6upn3oa	本地生活	title	对比	对比	洗车师傅用软水+中性PH洗剂，车身水痕比我家镜子还少	\N	\N	f	ai	t	2026-08-09 14:23:24.687	2026-08-09 14:23:24.687
cmslw7jf40085i5pyhgk0kq83	本地生活	title	对比	对比	维修师傅包里常备三双白手套：检修、安装、收尾各一副	\N	\N	f	ai	t	2026-08-09 14:23:24.688	2026-08-09 14:23:24.688
cmslw7jf40086i5pyqerxi31x	本地生活	title	对比	对比	保洁阿姨边干活边念口诀：“厨房油渍三遍擦，卫生间水垢两遍刷”	\N	\N	f	ai	t	2026-08-09 14:23:24.689	2026-08-09 14:23:24.689
cmslw7jf50087i5py3rvrf3bp	本地生活	title	对比	对比	上海静安区327户家庭选择的包年保洁，平均每月省4.2小时	\N	\N	f	ai	t	2026-08-09 14:23:24.69	2026-08-09 14:23:24.69
cmslw7jf60088i5pyn7g6jgf0	本地生活	title	对比	对比	师傅修完灯，顺手把客厅所有插座拧紧，并贴上“已安检”标签	\N	\N	f	ai	t	2026-08-09 14:23:24.691	2026-08-09 14:23:24.691
cmslw7jf70089i5py54z7mpot	本地生活	title	对比	对比	为什么暴雨季我们接单量涨了300%？因为提前72小时巡检排水口	\N	\N	f	ai	t	2026-08-09 14:23:24.692	2026-08-09 14:23:24.692
cmslw7jf8008ai5pybxaiic7d	本地生活	title	对比	对比	宠物洗澡全程监控可看，吹干温度实时显示，连耳道都用药棉清理	\N	\N	f	ai	t	2026-08-09 14:23:24.693	2026-08-09 14:23:24.693
cmslw7jf9008bi5pyv1rerhff	本地生活	title	对比	对比	“你们连马桶底座螺丝都换了新的？”——客户指着旧件照片问	\N	\N	f	ai	t	2026-08-09 14:23:24.694	2026-08-09 14:23:24.694
cmslw8q4c008ci5pyr89y4vdm	本地生活	article	新客引流	\N	\N	新客首次下单立减30元！无需凑单，无隐藏费用——保洁阿姨持证上岗、自带消毒喷雾和蓝光检测仪，服务后现场用紫外线灯照地板，黑斑即现即清。下单时勾选“新手保障包”，享48小时免费返工+10元迟到补偿。今天预约，明天上门，全程APP可查师傅定位与服务进度。已有2763位邻居用过这波福利，后台显示复购率超62%。点击领取→	\N	f	ai	t	2026-08-09 14:24:20.019	2026-08-09 14:24:20.019
cmslw8q4i008di5pycncqkdii	本地生活	article	老客复购	\N	\N	刚搬进新家？别急着买清洁剂！我们免费送你《精装房开荒避坑清单》（含8处易藏灰死角图解+3种胶渍清除法），扫码添加客服即领。再送9.9元深度除螨体验券（原价88元，含吸尘+高温蒸汽+臭氧消杀三步）。师傅上门自带显微镜级尘螨检测仪，拍下对比图发你。不推销、不加项，做完直接扫码评价，满意再付款。	\N	f	ai	t	2026-08-09 14:24:20.035	2026-08-09 14:24:20.035
cmslw8q4k008ei5pyvamsug0f	本地生活	article	产品种草	\N	\N	试过才知道什么叫“真·省心”：现在注册即送20元无门槛券，支持拆分使用（比如10元洗车+10元家电清洗）。所有服务明码标价，项目页标注“含什么、不含什么”，连抹布更换频次都写清楚。师傅着装统一、工具箱贴消毒记录贴。上周有位宝妈下单儿童房保洁，结束时阿姨主动帮她把积木按颜色分类收好——细节，才是靠谱的开始。	\N	f	ai	t	2026-08-09 14:24:20.036	2026-08-09 14:24:20.036
cmslw8q4l008fi5pypgnqg24j	本地生活	article	客户见证	\N	\N	老客复购享专属“安心锁”：订单自动延长售后期至15天（行业普遍3天），且第2次起每次下单多赠1次免费补救服务。上月王姐连续订了4次油烟机清洗，系统自动升级为银卡，下次直接减35元。你的服务记录我们存档3年，换房搬家也能一键同步地址与偏好（比如“不用柠檬味清洁剂”“宠物猫在家请穿鞋套”）。信任，是反复选择的结果。	\N	f	ai	t	2026-08-09 14:24:20.037	2026-08-09 14:24:20.037
cmslw8q4m008gi5pye7itp2ed	本地生活	article	节假日活动	\N	\N	老客户专享“回头约”通道：APP首页下滑→点“我的预约”→右上角“优先派单”开关打开，系统自动为你匹配同一位服务师傅（只要他/她有档期）。李叔说：“张师傅给我修了3次热水器，连我家阀门型号都记住了。”我们也支持备注“请上次那位阿姨”，92%的订单能如愿匹配。熟人服务，少解释、更放心。	\N	f	ai	t	2026-08-09 14:24:20.038	2026-08-09 14:24:20.038
cmslw8q4n008hi5py5p9v7av3	本地生活	article	品牌故事	\N	\N	会员生日月双倍积分+免费加项：当月下单任意服务，可任选1项免费升级（如保洁加擦玻璃、家电清洗加滤网消毒）。积分永久有效，满200分兑免单券，满500分兑全年保洁85折。上季度陈阿姨用积分兑了2次宠物洗澡，还剩187分——她说：“攒着等换新沙发，让师傅顺手做一次深度防螨处理。	\N	f	ai	t	2026-08-09 14:24:20.039	2026-08-09 14:24:20.039
cmslw8q4o008ii5py6hppcn1w	本地生活	article	上新公告	\N	\N	推荐3个朋友注册并完成首单，你得100元无门槛券+朋友各得30元。邀请码生成后，分享到微信/朋友圈，实时查看谁已下单。被邀人首单还能叠加新人立减，双方都不耽误优惠。上个月刘哥靠这个省了420元，还帮邻居解决了漏水维修难题——靠谱的事，值得被更多人知道。	\N	f	ai	t	2026-08-09 14:24:20.04	2026-08-09 14:24:20.04
cmslw8q4p008ji5py9g1guf23	本地生活	article	优惠活动	\N	\N	客户见证｜朝阳区李女士：“婆婆术后在家休养，我预约了每周2次深度保洁。师傅每次来先测体温、换鞋套、用酒精湿巾擦工具，连马桶水箱盖内侧都刷得反光。最感动的是，有次我忘关窗下雨，阿姨冒雨回来重做阳台——没要一分钱，只说‘您家老人呼吸要紧’。	\N	f	ai	t	2026-08-09 14:24:20.041	2026-08-09 14:24:20.041
cmslwa66l00axi5pybpduas8x	电商零售	title	对比	对比	618提前抢！库存告急的云感棉T恤，今晚20:00恢复原价	\N	\N	f	ai	t	2026-08-09 14:25:27.501	2026-08-09 14:25:27.501
cmslw8q4q008ki5pynbtz8thy	本地生活	article	知识科普	\N	\N	客户见证｜海淀带娃爸爸张先生：“给娃洗过的衣服总泛黄？师傅用专业PH试纸测了我家洗衣机内筒，发现碱性残留超标，当场用食品级柠檬酸循环清洗，还教我每月自洁口诀。现在娃衣服白净柔软，连儿科医生都说‘这家庭卫生管理挺科学’。	\N	f	ai	t	2026-08-09 14:24:20.042	2026-08-09 14:24:20.042
cmslw8q4r008li5pyjk488bvt	本地生活	article	互动话题	\N	\N	客户见证｜西城独居赵阿姨：“72岁，不会用APP。女儿教我打400电话预约，师傅老周不仅准时到，还帮我把过期药品分类打包、联系社区回收点，顺手检查了燃气报警器电池。走时留了张手写卡：‘赵姨，下周二我再来，您冰箱里那盒酸奶快到期了’。	\N	f	ai	t	2026-08-09 14:24:20.043	2026-08-09 14:24:20.043
cmslw8q4r008mi5py4wcbkeby	本地生活	article	答疑辟谣	\N	\N	春节不打烊｜除夕至初五，保洁/维修/宠物寄养照常接单！订单加收20%节日服务费（明示在价格页），但每单赠送“福袋”：含消毒湿巾×5、定制春联一对、应急联系卡（含物业/开锁/医院直通车号码）。提前3天预约享免排队权，师傅出发前1小时发定位+服务承诺书。团圆时刻，琐事交给我们。	\N	f	ai	t	2026-08-09 14:24:20.044	2026-08-09 14:24:20.044
cmslw8q4s008ni5pyq59ahj0v	本地生活	article	会员权益	\N	\N	端午焕新计划｜即日起至6月10日，下单全屋保洁/空调深度清洗/沙发除螨，立减50元！加9.9元升级“艾草驱螨护理”（含艾草精油雾化+紫外线照射）。晒单带#端午清爽家 话题，抽10位送定制香囊+全年防虫服务券。老客户转介绍成功，双方再各得20元——干净，就该热热闹闹地过。	\N	f	ai	t	2026-08-09 14:24:20.044	2026-08-09 14:24:20.044
cmslw8q4t008oi5pykyj9qrd1	本地生活	article	会员权益	\N	\N	中秋团圆礼｜为父母/岳父母下单任意上门服务，备注“敬老订单”，免费加赠“适老化关怀包”：防滑垫检测+插座松动排查+灯光亮度测试报告。订单满299元，额外送手工月饼一盒（鲜肉/豆沙双口味）。我们不只擦亮家具，更想擦亮家人眼里的安心。	\N	f	ai	t	2026-08-09 14:24:20.045	2026-08-09 14:24:20.045
cmslw8q4t008pi5py2ps3mby3	本地生活	article	会员权益	\N	\N	品牌故事｜2018年，创始人老陈在小区修水管时，看见邻居阿姨蹲在楼道擦瓷砖缝霉斑，手冻得通红。他掏出工具箱里的紫外线灯一照，整面墙全是黑斑。“原来不是懒，是不知道怎么干对。”于是他拉起5个老师傅，坚持“三不接”：没健康证不接、不带专业设备不接、报价单不写清耗材不接。七年过去，服务过11.2万户，差评率始终低于0.3%。	\N	f	ai	t	2026-08-09 14:24:20.046	2026-08-09 14:24:20.046
cmslw8q4u008qi5pyqdr4209l	本地生活	article	会员权益	\N	\N	品牌故事｜我们的工具箱里有3样“非标配”：德国产蓝光检测仪（查隐形污渍）、医用级臭氧发生器（宠物家庭专用）、可降解竹纤维抹布（每块独立灭菌封装）。采购成本比同行高47%，但阿姨说：“摸着踏实，客户也愿意多等5分钟。”——省下的钱，不该花在看不见的地方。	\N	f	ai	t	2026-08-09 14:24:20.047	2026-08-09 14:24:20.047
cmslw8q4v008ri5pyeyl3selo	本地生活	article	会员权益	\N	\N	品牌故事｜去年暴雨夜，丰台某小区地下室积水。我们临时组建7人应急队，冒雨抢修排水泵、帮居民转移物品，全程未收1分钱。事后有业主送来锦旗，上面写着“不是亲人，胜似亲人”。我们把它挂在培训室墙上，新师傅入职第一课：服务，是雪中送炭，不是锦上添花。	\N	f	ai	t	2026-08-09 14:24:20.047	2026-08-09 14:24:20.047
cmslw8q4v008si5py0h13wk09	本地生活	article	会员权益	\N	\N	上新公告｜即日起，“儿童房安全焕新套餐”上线！含：甲醛净化（纳米光触媒喷涂）+玩具消毒（医用级臭氧柜）+边角防护（食品级硅胶条安装）+地面防滑检测。所有试剂提供SGS报告编号，施工全程录像可回看。首月预约享8折，另赠《宝宝居家安全自查表》电子版。	\N	f	ai	t	2026-08-09 14:24:20.048	2026-08-09 14:24:20.048
cmslw8q4w008ti5py1dc0mvo2	本地生活	article	会员权益	\N	\N	上新公告｜“银发友好维修包”正式启用：师傅均通过老年心理沟通培训，携带大字版操作指南、带放大镜的测电笔、可调节高度的维修凳。支持“子女远程授权+视频指导”模式，修完生成《适老改造建议书》（含扶手安装点位/灯光色温建议）。首批开放200个体验名额，扫码锁定权益。	\N	f	ai	t	2026-08-09 14:24:20.049	2026-08-09 14:24:20.049
cmslw8q4x008ui5pyw21rli3x	本地生活	article	会员权益	\N	\N	上新公告｜宠物家庭专属“毛孩子安心日”启动：上门保洁同步进行宠物毛发蛋白酶分解+地毯深层螨虫灭活；洗护服务新增“应激安抚流程”（含费洛蒙喷雾、静音吹水机、零食奖励包）。所有用品经农业农村部认证，服务后提供《环境过敏原检测简报》。养宠不易，我们多做一步。	\N	f	ai	t	2026-08-09 14:24:20.049	2026-08-09 14:24:20.049
cmslw8q4x008vi5pykakkqxvu	本地生活	article	会员权益	\N	\N	限时特惠｜本周四晚8点，直播间抢“年度省心卡”：199元=12次基础保洁（每次3小时）+2次家电清洗+1次全屋消杀，均价低至29元/次！下单即锁价，有效期365天，过期未用自动退。前50名加赠“应急保洁券”（30分钟极速响应，不限次）。手慢真无！	\N	f	ai	t	2026-08-09 14:24:20.05	2026-08-09 14:24:20.05
cmslw8q4y008wi5py5705qwjx	本地生活	article	会员权益	\N	\N	限时特惠｜旧家电以旧换新补贴开启！美的/海尔/格力等品牌空调、洗衣机、油烟机，凭购机发票或机身编码，最高抵800元（用于抵扣清洗/维修/换新服务）。师傅上门免费检测性能衰减率，出具《延寿评估报告》。不是所有旧机器都该扔，有些，只是累了。	\N	f	ai	t	2026-08-09 14:24:20.05	2026-08-09 14:24:20.05
cmslw8q4z008xi5pyc8oiuhqc	本地生活	article	会员权益	\N	\N	限时特惠｜“错峰清洁日”来了！工作日上午9-11点下单保洁，享5折！专为自由职业者、居家办公族、带娃家长设计。避开高峰时段，价格更低、师傅更专注、服务更细致。订单备注“错峰”，额外送《高效家务动线图》（含厨房/卫生间黄金三角布局）。聪明的人，都懂挑时间。	\N	f	ai	t	2026-08-09 14:24:20.051	2026-08-09 14:24:20.051
cmslw8q4z008yi5pypltxfoxq	本地生活	article	会员权益	\N	\N	知识科普｜为什么拖完地反而更滑？90%家庭用错了清洁剂！碱性拖地液会与地砖钙质反应生成滑腻膜。我们只用PH值6.8-7.2的中性清洁剂，拖完地面哑光不打滑。附赠小贴士：拖把拧干至“拧不出水但拎起滴3滴”为最佳湿度。	\N	f	ai	t	2026-08-09 14:24:20.052	2026-08-09 14:24:20.052
cmslw8q50008zi5pyy5p324q3	本地生活	article	会员权益	\N	\N	知识科普｜空调半年不洗=全家吸“尘肺”？滤网积灰含螨虫尸体、霉菌孢子、皮屑蛋白，出风时直吹呼吸道。专业清洗需拆机洗蒸发器+冷凝水盘+风轮，仅表面擦拭无效。我们用可视化内窥镜直播清洗过程，脏水变清才算达标。	\N	f	ai	t	2026-08-09 14:24:20.053	2026-08-09 14:24:20.053
cmslw8q510090i5pyazk8py8u	本地生活	article	会员权益	\N	\N	知识科普｜沙发不是擦擦就行！布艺沙发纤维深处藏螨量可达每平方厘米2000只。普通吸尘仅清除表层，需配合58℃以上高温蒸汽+定向负压吸附+生物酶分解，才能断根。服务后提供显微镜级清洁前后对比图，螨虫数量下降≥92.6%（第三方检测报告可查）。	\N	f	ai	t	2026-08-09 14:24:20.053	2026-08-09 14:24:20.053
cmslw8q520091i5pyf7gy7fnh	本地生活	article	会员权益	\N	\N	互动话题｜你家最“难搞”的卫生死角是哪？是冰箱密封条发黑？还是洗衣机胶圈长霉？或是抽油烟机涡轮藏油？评论区留言+📍城市，抽10位送《死角攻坚包》（含专用清洁膏+窄缝刷+检测紫外线笔）。真实问题，我们真解决。	\N	f	ai	t	2026-08-09 14:24:20.054	2026-08-09 14:24:20.054
cmslw8q530092i5py5uol5urb	本地生活	article	会员权益	\N	\N	互动话题｜如果给家政阿姨打10分，你扣分的点通常是什么	\N	f	ai	t	2026-08-09 14:24:20.055	2026-08-09 14:24:20.055
cmslw93mx0093i5py1bgadzu2	本地生活	topic	\N	\N	春节前大扫除攻略：保洁阿姨上门实录，玻璃/灶台/油烟机深度清洁前后对比	\N	\N	f	ai	t	2026-08-09 14:24:37.544	2026-08-09 14:24:37.544
cmslw93mz0094i5pyt58icdzn	本地生活	topic	\N	\N	元宵节后换季收纳：专业收纳师3小时改造小户型衣橱全过程	\N	\N	f	ai	t	2026-08-09 14:24:37.548	2026-08-09 14:24:37.548
cmslw93n00095i5pyk7v1hsrp	本地生活	topic	\N	\N	三八妇女节特辑：全城女性专属家政85折，附赠免费家电安全检测	\N	\N	f	ai	t	2026-08-09 14:24:37.549	2026-08-09 14:24:37.549
cmslw93n20096i5pyxhla2hm5	本地生活	topic	\N	\N	清明踏青季来临，宠物寄养需求暴增！24小时监控+每日视频反馈真实记录	\N	\N	f	ai	t	2026-08-09 14:24:37.55	2026-08-09 14:24:37.55
cmslw93n30097i5pyxgkkysfg	本地生活	topic	\N	\N	五一劳动节致敬劳动者：维修师傅10年从业故事+免费家电基础巡检活动	\N	\N	f	ai	t	2026-08-09 14:24:37.551	2026-08-09 14:24:37.551
cmslw93n40098i5pyyda1yw78	本地生活	topic	\N	\N	端午节前除螨行动：高温蒸汽+医用级除螨仪实测，床褥螨虫数量下降92%	\N	\N	f	ai	t	2026-08-09 14:24:37.553	2026-08-09 14:24:37.553
cmslw93n50099i5py2ggln2aj	本地生活	topic	\N	\N	618本地生活专场：洗护服务包年立省42%，含3次免费加急上门	\N	\N	f	ai	t	2026-08-09 14:24:37.554	2026-08-09 14:24:37.554
cmslw93n6009ai5py7q4d2gnt	本地生活	topic	\N	\N	暑假开始，空调深度清洗预约爆满！拆机清洗全过程+出风洁净度检测报告	\N	\N	f	ai	t	2026-08-09 14:24:37.555	2026-08-09 14:24:37.555
cmslw93n8009bi5pywkmu5fj0	本地生活	topic	\N	\N	七夕节宠自己：高端皮具养护到家服务，LV/Gucci包包修复前后对比	\N	\N	f	ai	t	2026-08-09 14:24:37.556	2026-08-09 14:24:37.556
cmslw93n9009ci5pynytx860m	本地生活	topic	\N	\N	开学季焕新家：学生房保洁+甲醛检测套餐，CMA认证报告当日出	\N	\N	f	ai	t	2026-08-09 14:24:37.557	2026-08-09 14:24:37.557
cmslw93na009di5pycx3if2d2	本地生活	topic	\N	\N	中秋团圆前厨房焕新：油污克星组合清洁（灶台/抽油烟机/微波炉）实拍	\N	\N	f	ai	t	2026-08-09 14:24:37.558	2026-08-09 14:24:37.558
cmslw93nb009ei5py7ktyycm8	本地生活	topic	\N	\N	国庆长假归来，全屋消杀服务咨询量翻倍！卫健委备案消杀团队作业纪实	\N	\N	f	ai	t	2026-08-09 14:24:37.559	2026-08-09 14:24:37.559
cmslw93nc009fi5pygwu3807x	本地生活	topic	\N	\N	重阳敬老月：为60岁以上老人免费提供水电检修+防滑垫安装（限前200名）	\N	\N	f	ai	t	2026-08-09 14:24:37.56	2026-08-09 14:24:37.56
cmslw93nd009gi5pylf2ctcdm	本地生活	topic	\N	\N	双11不囤货，囤服务！保洁/维修/宠物托管全年卡限时开放预约通道	\N	\N	f	ai	t	2026-08-09 14:24:37.561	2026-08-09 14:24:37.561
cmslw93ne009hi5py53irde9o	本地生活	topic	\N	\N	冬至进补季，地暖清洗正当时！内壁水垢可视化检测+清洗前后水流量对比	\N	\N	f	ai	t	2026-08-09 14:24:37.562	2026-08-09 14:24:37.562
cmslw93nf009ii5pyte3j8xfq	本地生活	topic	\N	\N	元旦焕新计划：旧物回收+新家保洁一站式服务，全程录像可追溯	\N	\N	f	ai	t	2026-08-09 14:24:37.563	2026-08-09 14:24:37.563
cmslw93ng009ji5pynudu68dl	本地生活	topic	\N	\N	腊八节前后，洗衣机槽深度清洁需求激增！内桶细菌培养皿实拍对比	\N	\N	f	ai	t	2026-08-09 14:24:37.564	2026-08-09 14:24:37.564
cmslw93nh009ki5py0t3ba7yd	本地生活	topic	\N	\N	寒假带娃忙，临时托宠服务上线！持证宠物护理师+独立监控房间实景直播	\N	\N	f	ai	t	2026-08-09 14:24:37.566	2026-08-09 14:24:37.566
cmslw93nj009li5pyi5w6rsie	本地生活	topic	\N	\N	情人节应急需求多：家电突发故障2小时极速响应实录（含收费明细公示）	\N	\N	f	ai	t	2026-08-09 14:24:37.567	2026-08-09 14:24:37.567
cmslw93nk009mi5pyvdosxind	本地生活	topic	\N	\N	3·15消费者权益日：我们把服务合同、报价单、保险单全公开在门店玻璃墙	\N	\N	f	ai	t	2026-08-09 14:24:37.568	2026-08-09 14:24:37.568
cmslw93nl009ni5pygalh7e0h	本地生活	topic	\N	\N	梅雨季防霉指南：墙面/卫生间/衣柜防霉处理实操，药剂成分与安全认证展示	\N	\N	f	ai	t	2026-08-09 14:24:37.569	2026-08-09 14:24:37.569
cmslw93nm009oi5pyjtcodszt	本地生活	topic	\N	\N	高考季静音保障：考前一周家电维修绿色通道+噪音设备免费检测	\N	\N	f	ai	t	2026-08-09 14:24:37.57	2026-08-09 14:24:37.57
cmslw93nn009pi5py0i6jn21l	本地生活	topic	\N	\N	暑期暴雨频发，屋顶/阳台漏水应急维修全流程（含防水质保协议签署）	\N	\N	f	ai	t	2026-08-09 14:24:37.572	2026-08-09 14:24:37.572
cmslw93no009qi5pylwa79r10	本地生活	topic	\N	\N	中秋后换季洗护高峰：真丝/羊绒/羽绒服专业分拣+恒温烘干过程记录	\N	\N	f	ai	t	2026-08-09 14:24:37.573	2026-08-09 14:24:37.573
cmslw93np009ri5pyql9ggn9j	本地生活	topic	\N	\N	立冬进补前，净水器滤芯更换提醒服务上线！旧滤芯杂质称重实测视频	\N	\N	f	ai	t	2026-08-09 14:24:37.574	2026-08-09 14:24:37.574
cmslw93nr009si5py22zy9juo	本地生活	topic	\N	\N	元旦跨年倒计时，全屋空气治理套餐含TVOC实时检测仪数据直播	\N	\N	f	ai	t	2026-08-09 14:24:37.575	2026-08-09 14:24:37.575
cmslw93ns009ti5py5c4hye90	本地生活	topic	\N	\N	春节返乡潮开启：空置房托管服务（每日巡检+远程开门+智能设备联动）	\N	\N	f	ai	t	2026-08-09 14:24:37.576	2026-08-09 14:24:37.576
cmslw93nt009ui5pytfvyow9v	本地生活	topic	\N	\N	情人节后宠物绝育咨询增多：合作动物医院+上门术后护理服务纪实	\N	\N	f	ai	t	2026-08-09 14:24:37.578	2026-08-09 14:24:37.578
cmslw93nu009vi5pyy4ijanfd	本地生活	topic	\N	\N	五一民宿旺季前，房东专属保洁升级包（布草消毒+床底除尘+差评痛点整改）	\N	\N	f	ai	t	2026-08-09 14:24:37.579	2026-08-09 14:24:37.579
cmslw93nv009wi5pydi9np6fh	本地生活	topic	\N	\N	夏至高温预警，冰箱冷凝器清洗服务预约量破千！清洗前后耗电量实测对比	\N	\N	f	ai	t	2026-08-09 14:24:37.58	2026-08-09 14:24:37.58
cmslw9jvc009xi5py9gczyh2e	本地生活	image_prompt	\N	\N	\N	一张干净明亮的居家保洁服务现场图：专业保洁员穿着统一蓝白工装，戴手套和口罩，正在用蒸汽拖把清洁木地板，地板反光映出窗外阳光，角落可见品牌LOGO工具箱和消毒液瓶，ins风柔焦浅景深，莫兰迪色系背景	\N	f	ai	t	2026-08-09 14:24:58.584	2026-08-09 14:24:58.584
cmslw9jve009yi5py27gxha5l	本地生活	image_prompt	\N	\N	\N	一张真实记录式保洁前后对比图：左侧凌乱积灰的厨房台面与油烟机，右侧同一角度光洁如新的台面与锃亮油烟机，保洁员背影弯腰擦拭，穿工装戴袖套，写实风格，自然光拍摄，细节清晰	\N	f	ai	t	2026-08-09 14:24:58.586	2026-08-09 14:24:58.586
cmslw9jvf009zi5pyp4gmmsji	本地生活	image_prompt	\N	\N	\N	一张国潮风家电清洗服务产品图：复古红金配色背景，蒸气熨斗、空调滤网、洗衣机槽清洁剂瓶身印有祥云纹+“净得稳”书法字，工具整齐摆放在青砖纹理托盘上，顶部飘带写“持证上岗·365天质保	\N	f	ai	t	2026-08-09 14:24:58.588	2026-08-09 14:24:58.588
cmslw9jvh00a0i5py2dbqfnr3	本地生活	image_prompt	\N	\N	\N	一家温馨整洁的社区维修门店外景：原木色招牌“老张师傅上门修”，玻璃门贴有“24小时响应”窗贴，门口绿植架旁放着工具车与待修小家电，ins风低饱和暖调，镜头略仰拍显亲切感	\N	f	ai	t	2026-08-09 14:24:58.589	2026-08-09 14:24:58.589
cmslw9jvi00a1i5pyp68g7tyo	本地生活	image_prompt	\N	\N	\N	一家写实风格的家电维修门店内景：老师傅戴眼镜正用万用表检测冰箱电路板，工作台铺防静电垫，背后货架整齐码放压缩机、继电器等配件，墙上挂三张技师资格证与“明码标价表”，自然光+补光灯	\N	f	ai	t	2026-08-09 14:24:58.59	2026-08-09 14:24:58.59
cmslw9jvj00a2i5pyytc1nasd	本地生活	image_prompt	\N	\N	\N	一家国潮风社区维修店门头图：朱红门框配金色铜铃与鲤鱼衔环，匾额“修得好·不返工”用楷体烫金，两侧对联“手巧心诚修百器，价清料真护万家”，灯笼下垂流苏，水墨晕染边框	\N	f	ai	t	2026-08-09 14:24:58.592	2026-08-09 14:24:58.592
cmslw9jvk00a3i5py3r2nh2fb	本地生活	image_prompt	\N	\N	\N	一张ins风家政服务年卡促销海报：浅米色渐变背景，中央悬浮透明亚克力卡牌写“全年保洁包年·立省1800元”，卡牌旁散落日历图标、钥匙扣、毛巾卷，右下角小字“含2次深度消杀+随时加钟	\N	f	ai	t	2026-08-09 14:24:58.593	2026-08-09 14:24:58.593
cmslw9jvl00a4i5pystjl8zjh	本地生活	image_prompt	\N	\N	\N	一张写实风格洗护服务活动海报：手机拍摄视角，社区公告栏贴着A4纸海报，手写字体“干洗+皮具护理=99元/次”，下方贴着三张真实价目表（衬衫/西装/羽绒服）及店主微信二维码，边缘微卷显真实感	\N	f	ai	t	2026-08-09 14:24:58.594	2026-08-09 14:24:58.594
cmslw9jvm00a5i5py3q0bhk5x	本地生活	image_prompt	\N	\N	\N	一张国潮风宠物上门洗澡活动海报：靛青底色配牡丹纹边框，中央卡通柴犬站在浴盆里甩水，水珠飞溅成篆书“洗得欢”三字，底部横幅“端午宠粉·送驱虫香囊”，印章落款“本地宠护联盟	\N	f	ai	t	2026-08-09 14:24:58.595	2026-08-09 14:24:58.595
cmslw9jvo00a6i5py1rnxi0ps	本地生活	image_prompt	\N	\N	\N	一位妈妈笑着递钥匙给穿工装的女保洁员，孩子趴在沙发上看绘本，茶几上放着刚签的服务确认单与透明价目表（列明“客厅2间¥128·含消毒”），ins风自然光+虚化背景突出人物互动	\N	f	ai	t	2026-08-09 14:24:58.596	2026-08-09 14:24:58.596
cmslw9jvp00a7i5pyyv9pnsz7	本地生活	image_prompt	\N	\N	\N	一位独居老人指着冰箱对维修师傅点头，师傅蹲着打开侧板检查线路，工具包敞开露出绝缘胶带与测电笔，桌上放着刚填好的《服务反馈单》写着“修好不收加班费”，写实纪实摄影风格	\N	f	ai	t	2026-08-09 14:24:58.597	2026-08-09 14:24:58.597
cmslw9jvq00a8i5pyz6m0o5bv	本地生活	image_prompt	\N	\N	\N	一对年轻夫妻和穿汉元素围裙的宠物美容师合影，狗狗戴蝴蝶结坐在新铺的樱花地垫上，背景墙贴满客户手写感谢卡（“毛孩子像换了毛！”“价格比宠物店便宜一半”），国潮插画风+柔光滤镜	\N	f	ai	t	2026-08-09 14:24:58.599	2026-08-09 14:24:58.599
cmslw9jvr00a9i5py4mesrxdq	本地生活	image_prompt	\N	\N	\N	周末午后阳光洒进阳台，保洁员收起吸尘器微笑挥手，窗台绿植摇曳，晾衣架上挂着刚洗净的棉麻窗帘，沙发扶手上搭着印有品牌Slogan的收纳袋，ins风慵懒治愈色调	\N	f	ai	t	2026-08-09 14:24:58.6	2026-08-09 14:24:58.6
cmslw9jvs00aai5pye0k4fcqd	本地生活	image_prompt	\N	\N	\N	深夜小区单元楼下，穿反光背心的维修师傅提工具箱快步走向电梯，手机屏幕亮着“已接单·10分钟抵达”，楼道感应灯刚亮起，写实夜拍风格，冷暖光交织增强临场感	\N	f	ai	t	2026-08-09 14:24:58.6	2026-08-09 14:24:58.6
cmslw9jvt00abi5pyhqbqcz40	本地生活	image_prompt	\N	\N	\N	雨天傍晚宠物上门服务场景：师傅穿防水围裙蹲在玄关给金毛吹毛，地上铺蓝白格子防滑垫，主人递热姜茶，窗外雨痕朦胧，国潮水墨渲染雨丝+暖光聚焦人物，题字“风雨无阻·宠你所爱	\N	f	ai	t	2026-08-09 14:24:58.601	2026-08-09 14:24:58.601
cmslwa65p00aci5pyvlh6n6nl	电商零售	title	数字	数字	39块9拿下专柜同源冰丝衬衫！洗10次都不起球	\N	\N	f	ai	t	2026-08-09 14:25:27.469	2026-08-09 14:25:27.469
cmslwa65s00adi5py2ovf8cab	电商零售	title	反差	反差	原价299，现在69还送运费险？这波羊毛不薅亏大了	\N	\N	f	ai	t	2026-08-09 14:25:27.472	2026-08-09 14:25:27.472
cmslwa65t00aei5pytc0up9wk	电商零售	title	疑问	疑问	显胖”“透光”“缩水”…你买T恤踩过的坑，我们全填平了	\N	\N	f	ai	t	2026-08-09 14:25:27.474	2026-08-09 14:25:27.474
cmslwa65v00afi5pyuqxjkqmh	电商零售	title	痛点	痛点	退货率仅0.3%！质检报告+实拍视频，敢这么卖因为真不怕验	\N	\N	f	ai	t	2026-08-09 14:25:27.475	2026-08-09 14:25:27.475
cmslwa65w00agi5pyai1bcmqj	电商零售	title	福利	福利	还没拆快递就猜到它会爆？第7批预售已售罄，补货倒计时48h	\N	\N	f	ai	t	2026-08-09 14:25:27.476	2026-08-09 14:25:27.476
cmslwa65x00ahi5pybda6tc3g	电商零售	title	权威数据	权威数据	穿去见家长被夸3次”｜素人买家秀真实记录，没修图没滤镜	\N	\N	f	ai	t	2026-08-09 14:25:27.478	2026-08-09 14:25:27.478
cmslwa65y00aii5pyim3dq7f6	电商零售	title	悬念	悬念	她囤了12件基础款内衣，三年没换过新——原因就藏在缝线里	\N	\N	f	ai	t	2026-08-09 14:25:27.479	2026-08-09 14:25:27.479
cmslwa65z00aji5pyptpufz3d	电商零售	title	共情	共情	5款夏日凉感裤测评清单：暴走2万步、地铁蹲坐1小时实测	\N	\N	f	ai	t	2026-08-09 14:25:27.48	2026-08-09 14:25:27.48
cmslwa66100aki5pybnh0wb4s	电商零售	title	故事	故事	端午前连夜改版！李佳琦直播间同款防晒衣，今天首发价	\N	\N	f	ai	t	2026-08-09 14:25:27.481	2026-08-09 14:25:27.481
cmslwa66200ali5pyotpt9hv9	电商零售	title	清单	清单	百元内买到“优衣库平替”？拆开看内衬才知道什么叫诚意	\N	\N	f	ai	t	2026-08-09 14:25:27.482	2026-08-09 14:25:27.482
cmslwa66300ami5pyuq4zkqsw	电商零售	title	热点	热点	差价高达218元！同一工厂、同批次布料，为什么我们只要99？	\N	\N	f	ai	t	2026-08-09 14:25:27.483	2026-08-09 14:25:27.483
cmslwa66400ani5pyxsu04o41	电商零售	title	对比	对比	95后宝妈试穿17套儿童防晒衣后，锁死这家店：透气不闷汗	\N	\N	f	ai	t	2026-08-09 14:25:27.485	2026-08-09 14:25:27.485
cmslwa66600aoi5pyu5w216h5	电商零售	title	对比	对比	1个细节让连衣裙贵3倍｜高支棉+双针绷缝工艺实拍拆解	\N	\N	f	ai	t	2026-08-09 14:25:27.486	2026-08-09 14:25:27.486
cmslwa66700api5pyucy0them	电商零售	title	对比	对比	显矮”“显胯宽”“腰线消失”…你不敢穿的裙子，我们重新剪裁	\N	\N	f	ai	t	2026-08-09 14:25:27.488	2026-08-09 14:25:27.488
cmslwa66900aqi5pyu2c5tk4h	电商零售	title	对比	对比	直播间下单立减30｜再送定制冰袖+防晒帽，仅限前200单	\N	\N	f	ai	t	2026-08-09 14:25:27.489	2026-08-09 14:25:27.489
cmslwa66a00ari5pyk7pd7bqg	电商零售	title	对比	对比	复购率76.2%！老客主动晒单说：“比去年买的还软，但便宜15块	\N	\N	f	ai	t	2026-08-09 14:25:27.491	2026-08-09 14:25:27.491
cmslwa66c00asi5pysnw194zf	电商零售	title	对比	对比	发货前我偷偷录了全程”｜打包→称重→贴单→装箱，无剪辑实拍	\N	\N	f	ai	t	2026-08-09 14:25:27.492	2026-08-09 14:25:27.492
cmslwa66e00ati5py20sat51i	电商零售	title	对比	对比	我妈说这裤子像给她量身定的”｜42岁真实买家，身高156体重132	\N	\N	f	ai	t	2026-08-09 14:25:27.494	2026-08-09 14:25:27.494
cmslwa66g00aui5py0umridhf	电商零售	title	对比	对比	他凌晨3点发来消息：“刚拆完，和图片一模一样，已推荐给同事	\N	\N	f	ai	t	2026-08-09 14:25:27.496	2026-08-09 14:25:27.496
cmslwa66h00avi5pyl0kq9a38	电商零售	title	对比	对比	8件基础款穿搭公式清单｜小个子/梨形/通勤党各配3套，直接抄作业	\N	\N	f	ai	t	2026-08-09 14:25:27.498	2026-08-09 14:25:27.498
cmslwa66j00awi5py83c9bzxp	电商零售	title	对比	对比	《2024夏季面料白皮书》数据：92%消费者因“洗后变形”弃购快消服饰	\N	\N	f	ai	t	2026-08-09 14:25:27.499	2026-08-09 14:25:27.499
cmslwa66m00ayi5pymzgepwrp	电商零售	title	对比	对比	别家卖199，我们卖89”｜同厂同纱同染，成本明细表已公开	\N	\N	f	ai	t	2026-08-09 14:25:27.503	2026-08-09 14:25:27.503
cmslwa66o00azi5pybsq62mzt	电商零售	title	对比	对比	贵2倍和便宜一半的雪纺衫，挂水洗机里转3次后…结果太真实	\N	\N	f	ai	t	2026-08-09 14:25:27.504	2026-08-09 14:25:27.504
cmslwa66q00b0i5py6t3n79st	电商零售	title	对比	对比	7天无理由+破损包赔+色差秒退｜售后承诺写进商品页首行	\N	\N	f	ai	t	2026-08-09 14:25:27.506	2026-08-09 14:25:27.506
cmslwa66s00b1i5pyxcrcwb1u	电商零售	title	对比	对比	收到以为寄错货”｜199元档位质感，实际成交价只要59	\N	\N	f	ai	t	2026-08-09 14:25:27.508	2026-08-09 14:25:27.508
cmslwa66t00b2i5py5ps9y7xu	电商零售	title	对比	对比	退货率行业均值18%，我们0.7%——背后是每单必检的3道品控	\N	\N	f	ai	t	2026-08-09 14:25:27.51	2026-08-09 14:25:27.51
cmslwa66v00b3i5pyo1rqx974	电商零售	title	对比	对比	试了11家，最后选它”｜上海白领亲测：空调房不冷、户外不闷	\N	\N	f	ai	t	2026-08-09 14:25:27.511	2026-08-09 14:25:27.511
cmslwa66w00b4i5pyqdcens9p	电商零售	title	对比	对比	不是所有‘冰丝’都凉”｜红外热成像仪实测：体表降温差4.2℃	\N	\N	f	ai	t	2026-08-09 14:25:27.513	2026-08-09 14:25:27.513
cmslwa66y00b5i5pyuhum0dgj	电商零售	title	对比	对比	6款早C晚A精华对比清单｜成分表+肤感+空瓶率，小白闭眼入	\N	\N	f	ai	t	2026-08-09 14:25:27.514	2026-08-09 14:25:27.514
cmslwa67000b6i5py8wgibvog	电商零售	title	对比	对比	刘亦菲同款防晒霜爆单后，我们找到代工厂做了平价升级版	\N	\N	f	ai	t	2026-08-09 14:25:27.516	2026-08-09 14:25:27.516
cmslwa67100b7i5py2zjqn54v	电商零售	title	对比	对比	洗3次就发硬？”｜把竞品和我们同机水洗，结果第2轮就分出高下	\N	\N	f	ai	t	2026-08-09 14:25:27.517	2026-08-09 14:25:27.517
cmslwa67200b8i5pyi73cuyxw	电商零售	title	对比	对比	被闺蜜追着要链接的莫兰迪色系套装，今天加赠收纳袋	\N	\N	f	ai	t	2026-08-09 14:25:27.519	2026-08-09 14:25:27.519
cmslwa67400b9i5pydrkqfthx	电商零售	title	对比	对比	显黑”“假面感”“搓泥”…你讨厌的粉底液问题，这支全避开	\N	\N	f	ai	t	2026-08-09 14:25:27.52	2026-08-09 14:25:27.52
cmslwa67600bai5pyd1dsyevl	电商零售	title	对比	对比	29.9元起！5支口红盲盒含3支热门口红色号，拆开全中	\N	\N	f	ai	t	2026-08-09 14:25:27.522	2026-08-09 14:25:27.522
cmslwa67700bbi5pylas0xoaj	电商零售	title	对比	对比	质检报告编号可查｜每批面料经SGS认证，截图发客服立刻回传	\N	\N	f	ai	t	2026-08-09 14:25:27.524	2026-08-09 14:25:27.524
cmslwa67900bci5pyl3091o7x	电商零售	title	对比	对比	第一次网购没犹豫”｜00后大学生说：“详情页连线头都拍清楚了	\N	\N	f	ai	t	2026-08-09 14:25:27.525	2026-08-09 14:25:27.525
cmslwa67a00bdi5pyiswukydc	电商零售	title	对比	对比	老公说我像换了个人”｜32岁二胎妈妈晒素颜照：用对底妆真的赢	\N	\N	f	ai	t	2026-08-09 14:25:27.527	2026-08-09 14:25:27.527
cmslwa67b00bei5pyb74guyy0	电商零售	title	对比	对比	10件小众设计感单品清单｜均价89，90%未上过小红书热搜但回购率超60%	\N	\N	f	ai	t	2026-08-09 14:25:27.528	2026-08-09 14:25:27.528
cmslwa67c00bfi5pyc6yd8fqa	电商零售	title	对比	对比	巴黎时装周后台同款真丝枕套，国内产线直供，省掉中间商30%溢价	\N	\N	f	ai	t	2026-08-09 14:25:27.529	2026-08-09 14:25:27.529
cmslwa67d00bgi5pyznx406wy	电商零售	title	对比	对比	不是所有莫代尔都软”｜显微镜下看纤维结构，我们多一道预缩处理	\N	\N	f	ai	t	2026-08-09 14:25:27.53	2026-08-09 14:25:27.53
cmslwa67e00bhi5pyw4yssjit	电商零售	title	对比	对比	怕买错尺码？”｜AI量体工具上线！上传3张图，自动推荐精准码数	\N	\N	f	ai	t	2026-08-09 14:25:27.531	2026-08-09 14:25:27.531
cmslwa67f00bii5pyckxd85oa	电商零售	title	对比	对比	差价够买2杯奶茶！同源羊绒混纺围巾，我们做到129还包邮	\N	\N	f	ai	t	2026-08-09 14:25:27.532	2026-08-09 14:25:27.532
cmslwa67g00bji5pycbq23xir	电商零售	title	对比	对比	洗完变黄”“领口松垮”“肩线歪斜”…基础款翻车真相揭秘	\N	\N	f	ai	t	2026-08-09 14:25:27.533	2026-08-09 14:25:27.533
cmslwa67i00bki5pywlqvy5eq	电商零售	title	对比	对比	限时48h｜下单即赠「穿搭诊断」服务，搭配师1v1帮你挑3套	\N	\N	f	ai	t	2026-08-09 14:25:27.534	2026-08-09 14:25:27.534
cmslwa67j00bli5pyxk9so1r8	电商零售	title	对比	对比	复购客户中63%来自老客带新｜他们说：“售后比客服还着急	\N	\N	f	ai	t	2026-08-09 14:25:27.535	2026-08-09 14:25:27.535
cmslwa67k00bmi5pyhq399gol	电商零售	title	对比	对比	收到就想拍照发圈”｜莫兰迪灰卫衣实拍：阳光下不泛白、阴天不沉闷	\N	\N	f	ai	t	2026-08-09 14:25:27.536	2026-08-09 14:25:27.536
cmslwa67l00bni5pyc7kfut3o	电商零售	title	对比	对比	不是所有‘抗皱’都靠谱”｜蒸汽熨斗直喷测试，我们10秒回弹	\N	\N	f	ai	t	2026-08-09 14:25:27.537	2026-08-09 14:25:27.537
cmslwbc1200boi5pyt5k8g1vs	电商零售	article	新客引流	\N	\N	新客引流：刚刷到我们？别划走！新人专享9.9元起试用装+包邮，下单还送「避坑指南」电子手册——教你3秒分辨真丝和仿真丝、怎么选不显胖的牛仔裤尺码。真实发货实拍图已备好，无套路无隐藏条款，7天无理由+运费险全包，手慢真的无！	\N	f	ai	t	2026-08-09 14:26:21.733	2026-08-09 14:26:21.733
cmslwbc1400bpi5py18461wpg	电商零售	article	老客复购	\N	\N	新客引流：第一次来？送你一份「新手通关礼包」：①专属新人券（满199减50）②免费穿搭顾问1对1服务③下单即抽「免单锦鲤」——昨天第37位新客小美抽中了！截图晒单还能再领5元无门槛券，试试手气？	\N	f	ai	t	2026-08-09 14:26:21.737	2026-08-09 14:26:21.737
cmslwbc1600bqi5pykuj0otjx	电商零售	article	产品种草	\N	\N	新客引流：不是所有“首单立减”都靠谱！我们敢把成本价贴在详情页：这款莫代尔T恤工厂直发价39元，新人券后29.9元，比某宝同款便宜12元还包邮！附赠洗涤小卡+尺码速查表，扫码加客服，立马帮你挑对颜色和尺码～	\N	f	ai	t	2026-08-09 14:26:21.739	2026-08-09 14:26:21.739
cmslwbc1800bri5py9cdi2a26	电商零售	article	客户见证	\N	\N	老客复购：老粉专属「回购加速包」上线！下单即返双倍积分（可当钱花），满299再送定制帆布袋+新品优先试用权。上个月回购3次的@杭州阿琳说：“洗5次没起球，线头都没松！”——你上次买的那款，悄悄升级了缝线工艺哦～	\N	f	ai	t	2026-08-09 14:26:21.74	2026-08-09 14:26:21.74
cmslwbc1900bsi5pygonocsy6	电商零售	article	节假日活动	\N	\N	老客复购：还记得去年夏天你囤的冰感防晒衣吗？今年它回来了！但不止是回归——腋下加了透气网、袖口做了防滑硅胶条、还新增雾霾蓝/燕麦灰2个绝美色！老客下单直接享85折+旧衣回收抵10元，环保又省钱～	\N	f	ai	t	2026-08-09 14:26:21.742	2026-08-09 14:26:21.742
cmslwbc1b00bti5pyfldso43n	电商零售	article	品牌故事	\N	\N	老客复购：系统识别到您常买基础款内衣——这次升级太值了！杯垫改用0感记忆棉，侧收更自然不勒肉；肩带加宽1cm+可拆卸U型托；老客专享价比首发低23%，还送替换肩带+收纳盒！评论区晒单返现，真实反馈我们看得见～	\N	f	ai	t	2026-08-09 14:26:21.743	2026-08-09 14:26:21.743
cmslwbc1c00bui5pyos7xalk8	电商零售	article	上新公告	\N	\N	产品种草：实拍！不是滤镜！这件亚麻混纺衬衫阳光下自带柔光感，垂感一流、不透不皱，空调房穿不闷，通勤搭西裤/牛仔裤都高级。细节控看这里：五粒天然贝壳扣、袖口双车线加固、后背暗褶设计——洗3次水洗标都没歪！	\N	f	ai	t	2026-08-09 14:26:21.745	2026-08-09 14:26:21.745
cmslwbc1e00bvi5pyge690snx	电商零售	article	优惠活动	\N	\N	产品种草：被问爆的「会呼吸」凉感袜来了！日本东丽Coolmax纱+足弓压力分区编织，实测穿4小时脚底干爽不黏腻。买家秀里@深圳李工说：“地铁站暴走2万步，脱鞋没异味！”每双独立灭菌包装，开箱即穿，敏感肌亲测无刺激～	\N	f	ai	t	2026-08-09 14:26:21.746	2026-08-09 14:26:21.746
cmslwbc1f00bwi5pyax9d64wx	电商零售	article	知识科普	\N	\N	产品种草：别再买“伪”纯棉毛巾了！我们扒了17家供应商，最终选中这家30年老厂：100%长绒棉+60支纱+割绒工艺，吸水快3秒、甩干不滴水、用半年依然蓬松。对比图已放详情页——左边是普通棉，右边是它，差距肉眼可见！	\N	f	ai	t	2026-08-09 14:26:21.748	2026-08-09 14:26:21.748
cmslwbc1g00bxi5pyvpvemkq6	电商零售	article	互动话题	\N	\N	客户见证：@成都薇薇（下单32次）：“去年囤的儿童防晒帽，娃戴两年帽檐都没变形！今年换季翻出来，洗完晒干还是挺括如新。”附图：孩子戴着帽子骑单车，帽檐阴影刚好遮住眼睛——妈妈群疯传的“神帽”真有其事！	\N	f	ai	t	2026-08-09 14:26:21.749	2026-08-09 14:26:21.749
cmslwbc1h00byi5py3vsclz4x	电商零售	article	答疑辟谣	\N	\N	客户见证：订单号#20240511-8827 的王女士，凌晨1点下单，早上8点就签收了！她留言说：“以为要等3天，结果顺丰次日达，连快递员都说‘你们家打包真严实’。”——真空压缩+加厚EPE边角保护，摔3次都不漏粉！	\N	f	ai	t	2026-08-09 14:26:21.75	2026-08-09 14:26:21.75
cmslwbc1j00bzi5pys14pqwq2	电商零售	article	会员权益	\N	\N	客户见证：上周收到的买家秀合集太戳心：@北京磊哥晒出工装裤配马丁靴通勤照，“蹲一天工地不磨裆”；@西安朵朵发娃穿云朵棉睡衣视频，“整晚蹬被子也没着凉”。真实，是我们最硬的广告语。	\N	f	ai	t	2026-08-09 14:26:21.751	2026-08-09 14:26:21.751
cmslwbc1k00c0i5pyaco6akhe	电商零售	article	会员权益	\N	\N	节假日活动：端午不只有粽子！「粽夏焕新」专场开启：满299抽龙舟盲盒（含限定香囊/艾草锤/现金券），满599加赠手作艾草香包+运费险加倍！下单备注“安康”，客服手写祝福卡随包裹出发～	\N	f	ai	t	2026-08-09 14:26:21.752	2026-08-09 14:26:21.752
cmslwbc1l00c1i5pybfbup48e	电商零售	article	会员权益	\N	\N	节假日活动：618别只盯大牌！我们把利润砍掉再砍——全场满199减80，爆款防晒衣直降129元，库存仅87件！还加赠「618冷静期」特权：下单后24小时内反悔，全额退+不扣运费险！	\N	f	ai	t	2026-08-09 14:26:21.753	2026-08-09 14:26:21.753
cmslwbc1l00c2i5py658uvky7	电商零售	article	会员权益	\N	\N	节假日活动：七夕不玩虚的！买情侣家居服，第二件0元（限同款），加赠手写情书信纸+火漆印章套装。真实故事征集同步开启：晒出你们的“日常心动瞬间”，TOP3送全年免单！截止前3天，库存告急预警⚠️	\N	f	ai	t	2026-08-09 14:26:21.754	2026-08-09 14:26:21.754
cmslwbc1n00c3i5py11m9eu2m	电商零售	article	会员权益	\N	\N	品牌故事：2015年，创始人蹲在东莞工厂盯了18天产线，就为让T恤下摆多锁一道线；2019年，团队飞新疆3趟，只为找到那批霜降后采摘的长绒棉；现在，我们仓库仍坚持人工验货——每件衣服抖3次、照灯查线头、平铺测色差。品质，从不外包。	\N	f	ai	t	2026-08-09 14:26:21.755	2026-08-09 14:26:21.755
cmslwbc1o00c4i5pyjzh4e35s	电商零售	article	会员权益	\N	\N	品牌故事：没有KOL代言，没有流量明星，只有3278条真实售后录音——客服小敏记得每位老客的肤质和尺码偏好；质检老张能靠手感分辨0.1mm厚度差异；就连退货包裹，都会手写便签：“感谢指正，已优化包装！”信任，是日拱一卒攒出来的。	\N	f	ai	t	2026-08-09 14:26:21.756	2026-08-09 14:26:21.756
cmslwbc1p00c5i5pyfnqffxoi	电商零售	article	会员权益	\N	\N	品牌故事：我们不做“快时尚”。每季只开发12款，但打样平均改版7.3次；面料合作厂必须提供SGS检测报告；连快递胶带都换成可降解款。有顾客说：“你们像在卖家人，不是卖货。”——这句评价，我们印在了新员工入职手册第一页。	\N	f	ai	t	2026-08-09 14:26:21.757	2026-08-09 14:26:21.757
cmslwbc1q00c6i5pyzowh02sj	电商零售	article	会员权益	\N	\N	上新公告：今早10点！「云感系列」家居服正式发售：莫代尔+桑蚕丝混纺，触感≈裸睡，机洗30次仍柔滑。重点来了——首批100套含专属编号证书+设计师手稿明信片，下单即锁库存，倒计时已挂首页！	\N	f	ai	t	2026-08-09 14:26:21.758	2026-08-09 14:26:21.758
cmslwbc1r00c7i5pyjvg7ig6l	电商零售	article	会员权益	\N	\N	上新公告：不是所有“轻薄”都叫凉感！全新AIR-SOFT科技面料来了：紫外线UPF50+、体感降温2.3℃、汗液3秒导出。实测对比视频已上线——左边竞品闷红脸，右边咱家穿着跳绳10分钟额头干爽！首批赠凉感贴纸+收纳挂袋～	\N	f	ai	t	2026-08-09 14:26:21.759	2026-08-09 14:26:21.759
cmslwbc1r00c8i5pywehzvj6z	电商零售	article	会员权益	\N	\N	上新公告：终于等到！断货472天的「山系机能短裤」回归！升级版：后腰加隐形松紧调节扣、大腿内侧加防磨硅胶条、口袋加磁吸闭合。老客优先购通道已开，库存实时显示，抢完即止——上次补货17秒售罄，这次你准备好了吗？	\N	f	ai	t	2026-08-09 14:26:21.76	2026-08-09 14:26:21.76
cmslwbc1s00c9i5py5hnoz6e9	电商零售	article	会员权益	\N	\N	优惠活动：不是噱头！全场满减真实让利：满199减40，满299减70，满499减130——每档都经得起计算器验算。更狠的是：凑单自由！不同品类可跨店合并结算，连袜子×3件都能参与满减，羊毛薅得明明白白～	\N	f	ai	t	2026-08-09 14:26:21.761	2026-08-09 14:26:21.761
cmslwbc1t00cai5pykq78ykvz	电商零售	article	会员权益	\N	\N	优惠活动：清仓不等于瑕疵！这批尾货全是仓库翻检出的“完美余量款”：无吊牌/无磨损/未拆封，仅因色系调整下架。全部5折起，部分款低至2.8折！附赠「清仓溯源单」：生产日期、质检编号、库存周转天数全公开，放心捡漏～	\N	f	ai	t	2026-08-09 14:26:21.762	2026-08-09 14:26:21.762
cmslwbc1u00cbi5pyruc8gz6s	电商零售	article	会员权益	\N	\N	优惠活动：会员日PLUS版来了！今天下单享三重加码：①折上折（会员价再打95折）②赠品翻倍（买1送2）③加赠「售后闪电权」：退换货优先审核+2小时响应。库存实时刷新，手速党请调好闹钟⏰	\N	f	ai	t	2026-08-09 14:26:21.763	2026-08-09 14:26:21.763
cmslwbc1v00cci5py1iviokwd	电商零售	article	会员权益	\N	\N	知识科普：别再乱用“抗菌”标签！国家新规：未通过GB/T 20944检测，不得宣称抗菌。我们每批袜子都送检，报告编号公示在详情页——你看得见的“抑菌率99.2%”，不是P图来的！	\N	f	ai	t	2026-08-09 14:26:21.764	2026-08-09 14:26:21.764
cmslwbc1w00cdi5pygerrjbu5	电商零售	article	会员权益	\N	\N	知识科普：为什么你的牛仔裤越洗越垮？关键在“酵素石洗”工艺！劣质厂用强碱腐蚀，纤维断裂；我们用食品级酵素酶，只分解表面浮色，保留筋骨感。洗10次对比图已更新，拉链处针脚依旧笔直～	\N	f	ai	t	2026-08-09 14:26:21.765	2026-08-09 14:26:21.765
cmslwbc1y00cei5pye0i2yol7	电商零售	article	会员权益	\N	\N	知识科普：防晒衣不是越厚越防晒！UPF值≠厚度，而取决于面料密度+涂层均匀度。我们这款经中纺院实测UPF400+（国标要求≥40），轻若蝉翼却挡99.99%紫外线。检测报告+紫外线对比实验视频，点开即看！	\N	f	ai	t	2026-08-09 14:26:21.766	2026-08-09 14:26:21.766
cmslwbc1z00cfi5pygm7vlwds	电商零售	article	会员权益	\N	\N	互动话题：评论区接龙！#我靠哪件单品续命整个夏天#	\N	f	ai	t	2026-08-09 14:26:21.767	2026-08-09 14:26:21.767
cmslwbc2000cgi5pyzchcqcgy	电商零售	article	会员权益	\N	\N	👉🏻例：@广州阿哲：“冰感防晒衣+折叠风扇，户外遛娃4小时不中暑！	\N	f	ai	t	2026-08-09 14:26:21.768	2026-08-09 14:26:21.768
cmslwbc2000chi5pyf4bh0i70	电商零售	article	会员权益	\N	\N	点赞TOP3送同款+手写感谢卡，文案走心程度，比字数更重要～	\N	f	ai	t	2026-08-09 14:26:21.769	2026-08-09 14:26:21.769
cmslwbc2100cii5pymtwz72hq	电商零售	article	会员权益	\N	\N	互动话题：坦白局：你买过最后悔的网购是？	\N	f	ai	t	2026-08-09 14:26:21.77	2026-08-09 14:26:21.77
cmslwbc2200cji5pylaxy6vxj	电商零售	article	会员权益	\N	\N	我们不删评、不屏蔽，精选10条扎心吐槽，下周出一期《避坑白皮书》——把大家踩过的雷，变成你的购物说明书！参与即送「防踩雷自查表」PDF～	\N	f	ai	t	2026-08-09 14:26:21.77	2026-08-09 14:26:21.77
cmslwbc2300cki5pyqcj51k7m	电商零售	article	会员权益	\N	\N	互动话题：晒出你的「神搭配」！用我们家任意单品+其他品牌，拍3张图：单穿/叠穿/场景照。最佳创意奖送全年穿搭顾问服务+新品盲盒！灵感来源不限：菜市场、地铁站、阳台晾衣杆…生活感，才是高级感！	\N	f	ai	t	2026-08-09 14:26:21.771	2026-08-09 14:26:21.771
cmslwbc2400cli5pyyifmswop	电商零售	article	会员权益	\N	\N	答疑辟谣：辟谣！所谓“纳米银离子抗菌袜”=智商税？真相：银离子易氧化失效，且需持续接触皮肤才起效。我们选的是瑞士HeiQ®智能温控技术，遇汗自动激活，洗50次仍有效——检测报告编号：HQ-2024-088，官网可查！	\N	f	ai	t	2026-08-09 14:26:21.772	2026-08-09 14:26:21.772
cmslwbc2400cmi5pyb5vhy0sj	电商零售	article	会员权益	\N	\N	答疑辟谣：客服不是机器人！你说“衣服洗后缩水”，我们不会回“按水洗标操作”。而是问：水温多少？	\N	f	ai	t	2026-08-09 14:26:21.773	2026-08-09 14:26:21.773
cmslwbpsu00cni5pye6nt6bx3	电商零售	topic	\N	\N	春装上新｜这3件衬衫一洗不皱还显瘦，通勤党已囤5件	\N	\N	f	ai	t	2026-08-09 14:26:39.581	2026-08-09 14:26:39.581
cmslwbpsx00coi5pynye1po9f	电商零售	topic	\N	\N	清明踏青穿搭｜防水帆布包+防刮牛仔裤，草地上坐半小时都不脏	\N	\N	f	ai	t	2026-08-09 14:26:39.585	2026-08-09 14:26:39.585
cmslwbpsy00cpi5py6n6dehch	电商零售	topic	\N	\N	樱花季限定｜樱花粉真丝睡衣实测：洗衣机甩干后没勾丝没褪色	\N	\N	f	ai	t	2026-08-09 14:26:39.587	2026-08-09 14:26:39.587
cmslwbpt000cqi5pyu430phpg	电商零售	topic	\N	\N	418大促预告｜去年爆卖20万单的空气炸锅，今年升级款提前剧透	\N	\N	f	ai	t	2026-08-09 14:26:39.588	2026-08-09 14:26:39.588
cmslwbpt100cri5py2g1o7nkk	电商零售	topic	\N	\N	打工人午休神器｜可折叠颈枕+冰感眼罩套装，办公室抽屉常驻TOP1	\N	\N	f	ai	t	2026-08-09 14:26:39.589	2026-08-09 14:26:39.589
cmslwbpt100csi5pyj8tm0ohj	电商零售	topic	\N	\N	五一出行清单｜能塞进登机箱的旅行套装（含分装瓶+折叠水杯+收纳袋）	\N	\N	f	ai	t	2026-08-09 14:26:39.59	2026-08-09 14:26:39.59
cmslwbpt300cti5pyhr753nio	电商零售	topic	\N	\N	儿童节预热｜无荧光剂纯棉儿童T恤，机洗30次后领口没松垮	\N	\N	f	ai	t	2026-08-09 14:26:39.591	2026-08-09 14:26:39.591
cmslwbpt400cui5py4frmqafv	电商零售	topic	\N	\N	618必蹲款｜直播间刚拆封的防晒衣，紫外线测试仪当场打假	\N	\N	f	ai	t	2026-08-09 14:26:39.592	2026-08-09 14:26:39.592
cmslwbpt500cvi5py3zq6fnw9	电商零售	topic	\N	\N	梅雨季救星｜防霉硅胶收纳盒实拍：放浴室柜里1个月没水渍没白点	\N	\N	f	ai	t	2026-08-09 14:26:39.593	2026-08-09 14:26:39.593
cmslwbpt600cwi5pyq24xrext	电商零售	topic	\N	\N	高考加油包｜护眼台灯+静音翻页计时器+薄荷味提神贴，家长群疯转	\N	\N	f	ai	t	2026-08-09 14:26:39.594	2026-08-09 14:26:39.594
cmslwbpt600cxi5pyzgr95y8w	电商零售	topic	\N	\N	夏夜露营热｜便携式投影仪+防蚊蚊帐组合， backyard露营真实出片	\N	\N	f	ai	t	2026-08-09 14:26:39.595	2026-08-09 14:26:39.595
cmslwbpt700cyi5pykiqfu073	电商零售	topic	\N	\N	防晒黑科技｜UPF50+冰感防晒帽实测：暴晒2小时帽檐不烫手	\N	\N	f	ai	t	2026-08-09 14:26:39.596	2026-08-09 14:26:39.596
cmslwbpt800czi5py0tk24ngs	电商零售	topic	\N	\N	七夕礼物榜｜小众设计师香薰礼盒，附手写贺卡+免费刻字服务	\N	\N	f	ai	t	2026-08-09 14:26:39.596	2026-08-09 14:26:39.596
cmslwbpt900d0i5pyxksan0ao	电商零售	topic	\N	\N	高温预警｜冰感凉席三件套，空调房里铺一晚不黏身不闷汗	\N	\N	f	ai	t	2026-08-09 14:26:39.597	2026-08-09 14:26:39.597
cmslwbpt900d1i5pyzdp3uc5o	电商零售	topic	\N	\N	开学季刚需｜学生党宿舍神器：磁吸挂钩+免打孔置物架+USB小夜灯	\N	\N	f	ai	t	2026-08-09 14:26:39.598	2026-08-09 14:26:39.598
cmslwbpta00d2i5pytv6xnjwo	电商零售	topic	\N	\N	中秋前置｜低糖月饼礼盒开箱：馅料用真材实料，包装可二次利用做收纳	\N	\N	f	ai	t	2026-08-09 14:26:39.599	2026-08-09 14:26:39.599
cmslwbptb00d3i5pyc4nkpqyc	电商零售	topic	\N	\N	十一出游｜轻量登山鞋实测：走2万步脚不酸，暴雨天踩水坑不渗水	\N	\N	f	ai	t	2026-08-09 14:26:39.6	2026-08-09 14:26:39.6
cmslwbptc00d4i5pyzr2dg99i	电商零售	topic	\N	\N	双11预售指南｜去年退货率＜0.8%的羽绒服，今年填充量+15%	\N	\N	f	ai	t	2026-08-09 14:26:39.6	2026-08-09 14:26:39.6
cmslwbptd00d5i5pyo8qg637i	电商零售	topic	\N	\N	秋冬过渡期｜羊羔毛马甲+薄针织内搭，早晚温差15℃无缝切换	\N	\N	f	ai	t	2026-08-09 14:26:39.601	2026-08-09 14:26:39.601
cmslwbptd00d6i5py7mosy731	电商零售	topic	\N	\N	感恩节特辑｜老客专属：下单即赠定制保温杯，杯身印你名字首字母	\N	\N	f	ai	t	2026-08-09 14:26:39.602	2026-08-09 14:26:39.602
cmslwbpte00d7i5pyc3srl4ek	电商零售	topic	\N	\N	双十二清仓｜断码不打折！最后50件羊毛混纺围巾，支持7天无理由退	\N	\N	f	ai	t	2026-08-09 14:26:39.603	2026-08-09 14:26:39.603
cmslwbptf00d8i5pywa67eann	电商零售	topic	\N	\N	冬至暖身｜恒温发热袜实测：-5℃户外站岗1小时脚底始终36℃	\N	\N	f	ai	t	2026-08-09 14:26:39.603	2026-08-09 14:26:39.603
cmslwbptg00d9i5pyjdmap7ez	电商零售	topic	\N	\N	圣诞氛围组｜可插电LED窗花+麋鹿毛绒挂饰，租房党秒变节日屋	\N	\N	f	ai	t	2026-08-09 14:26:39.604	2026-08-09 14:26:39.604
cmslwbptg00dai5pyuy0o3sle	电商零售	topic	\N	\N	跨年倒计时｜手机支架+桌面加湿器+暖光台灯三件套，熬夜跨年不干脸	\N	\N	f	ai	t	2026-08-09 14:26:39.605	2026-08-09 14:26:39.605
cmslwbpth00dbi5pyxw49rmvj	电商零售	topic	\N	\N	元旦焕新｜旧衣回收换券：寄3件旧衣，立减80元买新家居服	\N	\N	f	ai	t	2026-08-09 14:26:39.605	2026-08-09 14:26:39.605
cmslwbpth00dci5py6gnycn51	电商零售	topic	\N	\N	春节返乡｜便携折叠泡脚桶+艾草包，高铁行李架上也能用	\N	\N	f	ai	t	2026-08-09 14:26:39.606	2026-08-09 14:26:39.606
cmslwbpti00ddi5pyb0ye09zs	电商零售	topic	\N	\N	年货节爆款｜真空封口机实测：封完牛肉干放3个月没返潮	\N	\N	f	ai	t	2026-08-09 14:26:39.606	2026-08-09 14:26:39.606
cmslwbpti00dei5pypkqxu913	电商零售	topic	\N	\N	情人节限定｜情侣款陶瓷马克杯，双杯同购送定制情书信纸	\N	\N	f	ai	t	2026-08-09 14:26:39.607	2026-08-09 14:26:39.607
cmslwbptj00dfi5pywebm7olr	电商零售	topic	\N	\N	春招季｜面试穿搭三件套：垂感西装裤+微光泽衬衫+低跟乐福鞋	\N	\N	f	ai	t	2026-08-09 14:26:39.607	2026-08-09 14:26:39.607
cmslwbptk00dgi5py2bgfpell	电商零售	topic	\N	\N	3·15特别企划｜所有商品附「材质检测报告」，扫码直查SGS原始数据	\N	\N	f	ai	t	2026-08-09 14:26:39.609	2026-08-09 14:26:39.609
cmslwckmj00e9i5py094sifgd	医疗健康	title	对比	对比	父母总说“没必要体检”，直到发现这个被忽略的早期信号	\N	\N	f	ai	t	2026-08-09 14:27:19.532	2026-08-09 14:27:19.532
cmslwc4n700dhi5pys0i34pzu	电商零售	image_prompt	\N	\N	\N	一张ins风新品针织衫平铺拍摄图，柔光白背景，浅灰亚麻布纹衬底，衣领微褶细节清晰，袖口罗纹特写，自然光影，低饱和莫兰迪色系，带小卡片标签“95%棉+5%氨纶｜机洗不缩水	\N	f	ai	t	2026-08-09 14:26:58.819	2026-08-09 14:26:58.819
cmslwc4na00dii5pyqrhnuqio	电商零售	image_prompt	\N	\N	\N	一张写实风格新品针织衫模特上身图，25岁亚洲女性穿浅米色针织衫站在真实阳光客厅中，窗外有绿植虚化，手捧咖啡杯微笑侧身，衣摆垂感自然，面料纹理可见，无滤镜，生活化构图	\N	f	ai	t	2026-08-09 14:26:58.822	2026-08-09 14:26:58.822
cmslwc4nb00dji5pyuypqmwwe	电商零售	image_prompt	\N	\N	\N	一张国潮风新品针织衫产品图，红金渐变丝绸背景，衣身绣有简化水墨云纹图案，衣角悬挂一枚铜制小铃铛，搭配毛笔字标牌“柔·韧·养”，暖黄射灯聚焦，传统与现代融合	\N	f	ai	t	2026-08-09 14:26:58.823	2026-08-09 14:26:58.823
cmslwc4nc00dki5pyjlvgsxci	电商零售	image_prompt	\N	\N	\N	一家ins风社区便利店外景图，浅木色门头+藤编招牌灯箱，玻璃门贴半透明磨砂膜印“今日鲜果补货”，门口摆放两盆琴叶榕和一辆复古自行车，午后斜阳拉长影子，色调清新干净	\N	f	ai	t	2026-08-09 14:26:58.824	2026-08-09 14:26:58.824
cmslwc4nc00dli5pyagmbxzuv	电商零售	image_prompt	\N	\N	\N	一家写实风格社区便利店内部图，中年店主系围裙整理货架，冷柜里堆满酸奶和即食饭团，收银台旁放着顾客刚扫码付款的手机，货架标签清晰可见“临期折扣区”，自然光从卷帘门缝隙洒入	\N	f	ai	t	2026-08-09 14:26:58.825	2026-08-09 14:26:58.825
cmslwc4nd00dmi5py8s46xuom	电商零售	image_prompt	\N	\N	\N	一家国潮风社区便利店夜景图，朱红色门框配烫金“福”字门贴，霓虹灯管拼出“廿四小时”字样，橱窗内陈列青花瓷纹样饮料瓶与竹编购物篮，地面反光倒映灯笼暖光，市井烟火气浓	\N	f	ai	t	2026-08-09 14:26:58.826	2026-08-09 14:26:58.826
cmslwc4ne00dni5pysn3dclw3	电商零售	image_prompt	\N	\N	\N	一张ins风618大促活动海报图，薄荷绿渐变底色，中央悬浮半透明购物袋剪影，袋内飘出草莓、蓝牙耳机、小熊软糖等3D扁平化图标，右下角手写字体“满199减50｜今晚8点开抢”，留白多，呼吸感强	\N	f	ai	t	2026-08-09 14:26:58.826	2026-08-09 14:26:58.826
cmslwc4ne00doi5pyf6nds5fj	电商零售	image_prompt	\N	\N	\N	一张写实风格618大促门店横幅图，红色绸布横幅悬挂在实体超市入口，字为喷绘黑体“618年中狂欢·全场折上折”，两侧挂满气球与彩带，背景可见排队顾客和堆高纸箱，真实促销现场感	\N	f	ai	t	2026-08-09 14:26:58.827	2026-08-09 14:26:58.827
cmslwc4nf00dpi5pyw0tx7kfr	电商零售	image_prompt	\N	\N	\N	一张国潮风618活动主视觉图，宣纸质感底纹上压印金色篆刻印章“六一八”，中央是Q版财神爷推购物车，车里装满锦鲤、元宝、二维码和龙纹快递盒，边框用祥云纹环绕，喜庆不俗气	\N	f	ai	t	2026-08-09 14:26:58.828	2026-08-09 14:26:58.828
cmslwc4ng00dqi5pyhr6tk8ym	电商零售	image_prompt	\N	\N	\N	一张ins风真实买家秀九宫格拼图，九张不同肤色/年龄用户手持同款防晒伞在不同场景：咖啡馆露台、地铁站、海边栈道，伞面朝上展示UPF50+标贴，每张图角落有手写体好评短句如“真的不闷汗！	\N	f	ai	t	2026-08-09 14:26:58.828	2026-08-09 14:26:58.828
cmslwc4ng00dri5py9apbgg1t	电商零售	image_prompt	\N	\N	\N	一张写实风格客户案例对比图，左侧为发货前仓库打包实拍（胶带封箱+电子面单特写），右侧为顾客拆箱视频截图（手指掀开盒盖露出产品+便签纸手写“包装超用心！”），中间箭头标注“48小时直达你家	\N	f	ai	t	2026-08-09 14:26:58.829	2026-08-09 14:26:58.829
cmslwc4nh00dsi5py77dadb2a	电商零售	image_prompt	\N	\N	\N	一张国潮风买家故事插画式配图，水墨晕染背景中三位人物：穿汉服女孩撑伞逛市集、戴眼镜男生在书桌前开箱、银发奶奶笑着把产品递给孙女，每人身边浮出对话框“回购第三次啦！”“送妈正合适！”“比专柜还细	\N	f	ai	t	2026-08-09 14:26:58.829	2026-08-09 14:26:58.829
cmslwc4ni00dti5pywayoha4y	电商零售	image_prompt	\N	\N	\N	一张ins风店铺氛围图，原木色试衣间内景，落地镜映出叠放整齐的牛仔外套与帆布托特包，镜面贴手绘小贴纸“试试看｜无理由退换”，窗台绿萝垂落，光线柔和，整体松弛治愈感	\N	f	ai	t	2026-08-09 14:26:58.83	2026-08-09 14:26:58.83
cmslwc4ni00dui5pycn5se0se	电商零售	image_prompt	\N	\N	\N	一张写实风格门店日常氛围图，傍晚时分奶茶店兼售零食货架前，两位年轻女生笑着翻看新上市话梅糖试吃装，店员正在补货，收银台旁立着“已消毒”立牌和体温计，生活气息浓郁	\N	f	ai	t	2026-08-09 14:26:58.831	2026-08-09 14:26:58.831
cmslwc4nj00dvi5pylvwbt5cq	电商零售	image_prompt	\N	\N	\N	一张国潮风会员日氛围图，深靛蓝丝绒幕布前陈列鎏金会员卡、青花瓷纹样积分罐与刻有“礼”字的木质礼盒，背景若隐若现水墨山峦，顶部悬挂纸扎灯笼，题字“老友记·尊享日	\N	f	ai	t	2026-08-09 14:26:58.832	2026-08-09 14:26:58.832
cmslwckm800dwi5pyi4oly92t	医疗健康	title	数字	数字	3个体检异常指标，可能不是病，但90%的人白跑医院	\N	\N	f	ai	t	2026-08-09 14:27:19.52	2026-08-09 14:27:19.52
cmslwckma00dxi5pysyacwqbe	医疗健康	title	反差	反差	三甲医生辞职后坚持做的1件事：教普通人看懂体检报告	\N	\N	f	ai	t	2026-08-09 14:27:19.522	2026-08-09 14:27:19.522
cmslwckmb00dyi5pyexm1hutb	医疗健康	title	疑问	疑问	每年体检都正常，却突然查出癌”？这5个盲区医生从不主动说	\N	\N	f	ai	t	2026-08-09 14:27:19.523	2026-08-09 14:27:19.523
cmslwckmc00dzi5pymo3tqqlk	医疗健康	title	痛点	痛点	凌晨2点急诊室里，我看到第7个因忽视这个症状送医的年轻人	\N	\N	f	ai	t	2026-08-09 14:27:19.524	2026-08-09 14:27:19.524
cmslwckmc00e0i5pyvgor1k40	医疗健康	title	福利	福利	体检中心护士私下告诉我：这4类人最该加做胃肠镜，别等有症状	\N	\N	f	ai	t	2026-08-09 14:27:19.525	2026-08-09 14:27:19.525
cmslwckmd00e1i5pybyylkbbw	医疗健康	title	权威数据	权威数据	为什么同样做甲状腺B超，有人查出结节，有人却漏诊？	\N	\N	f	ai	t	2026-08-09 14:27:19.526	2026-08-09 14:27:19.526
cmslwckme00e2i5pyfzay5l7h	医疗健康	title	悬念	悬念	明明血糖正常，医生却说你已进入糖尿病前期？真相在这	\N	\N	f	ai	t	2026-08-09 14:27:19.527	2026-08-09 14:27:19.527
cmslwckmf00e3i5pyjqdd326b	医疗健康	title	共情	共情	体检报告上这个“↑”符号，比所有箭头都更值得你立刻挂号	\N	\N	f	ai	t	2026-08-09 14:27:19.527	2026-08-09 14:27:19.527
cmslwckmg00e4i5pykxz9abu5	医疗健康	title	故事	故事	她32岁，体检一切正常，半年后确诊乳腺癌——漏掉的正是这项检查	\N	\N	f	ai	t	2026-08-09 14:27:19.528	2026-08-09 14:27:19.528
cmslwckmg00e5i5pywdl5npji	医疗健康	title	清单	清单	没症状=没病”？心内科主任：这是我们接诊时最怕听到的一句话	\N	\N	f	ai	t	2026-08-09 14:27:19.529	2026-08-09 14:27:19.529
cmslwckmh00e6i5pyrt58ahwq	医疗健康	title	热点	热点	你的体检套餐，真的覆盖了全家人的高发风险吗？	\N	\N	f	ai	t	2026-08-09 14:27:19.53	2026-08-09 14:27:19.53
cmslwckmi00e7i5pykr04236s	医疗健康	title	对比	对比	体检前吃早餐会影响哪几项结果？90%的人答错了	\N	\N	f	ai	t	2026-08-09 14:27:19.53	2026-08-09 14:27:19.53
cmslwckmi00e8i5pycgchibr1	医疗健康	title	对比	对比	体检花了3000元，却漏掉了最该查的2个项目？	\N	\N	f	ai	t	2026-08-09 14:27:19.531	2026-08-09 14:27:19.531
cmslwckmk00eai5pyofof35ou	医疗健康	title	对比	对比	孩子近视加深快？可能不是用眼问题，而是缺了这项基础筛查	\N	\N	f	ai	t	2026-08-09 14:27:19.532	2026-08-09 14:27:19.532
cmslwckmk00ebi5py6vbjf98u	医疗健康	title	对比	对比	全国三甲医院体检中心最新统计：62.3%的脂肪肝患者同时存在胰岛素抵抗	\N	\N	f	ai	t	2026-08-09 14:27:19.533	2026-08-09 14:27:19.533
cmslwckml00eci5pygnbi3uvx	医疗健康	title	对比	对比	《中国体检人群健康白皮书2024》披露：35岁以上人群幽门螺杆菌检出率高达48.7%	\N	\N	f	ai	t	2026-08-09 14:27:19.534	2026-08-09 14:27:19.534
cmslwckmm00edi5pyqf0oq025	医疗健康	title	对比	对比	卫健委数据：每100个高血压初诊患者中，仅37人完成规范靶器官评估	\N	\N	f	ai	t	2026-08-09 14:27:19.534	2026-08-09 14:27:19.534
cmslwckmm00eei5pye8yx2bcj	医疗健康	title	对比	对比	国家癌症中心最新随访显示：早筛早诊使结直肠癌5年生存率提升至91.2%	\N	\N	f	ai	t	2026-08-09 14:27:19.535	2026-08-09 14:27:19.535
cmslwckmo00efi5pyzod6q9l1	医疗健康	title	对比	对比	《中华健康管理学杂志》研究证实：年度低剂量螺旋CT可使肺癌死亡率降低20%	\N	\N	f	ai	t	2026-08-09 14:27:19.536	2026-08-09 14:27:19.536
cmslwckmo00egi5pyvrhnezf2	医疗健康	title	对比	对比	体检报告上那个“建议随访”，到底多久去一次？没人告诉你标准	\N	\N	f	ai	t	2026-08-09 14:27:19.537	2026-08-09 14:27:19.537
cmslwckmp00ehi5pyzua7xjjw	医疗健康	title	对比	对比	这家社区医院为何连续3年体检复购率达86%？背后是套标准化流程	\N	\N	f	ai	t	2026-08-09 14:27:19.537	2026-08-09 14:27:19.537
cmslwckmq00eii5pyzwh7ecq8	医疗健康	title	对比	对比	他做完PET-CT后，医生没让他住院，反而开了张“生活方式处方	\N	\N	f	ai	t	2026-08-09 14:27:19.538	2026-08-09 14:27:19.538
cmslwckmq00eji5pylz19ltvw	医疗健康	title	对比	对比	预约体检总要排队？我们把核磁共振排期压缩到72小时内，怎么做到的？	\N	\N	f	ai	t	2026-08-09 14:27:19.539	2026-08-09 14:27:19.539
cmslwckmr00eki5pygem5v4hj	医疗健康	title	对比	对比	刚入职就收到公司体检报告，HR悄悄塞给我一张“异常指标解读卡	\N	\N	f	ai	t	2026-08-09 14:27:19.54	2026-08-09 14:27:19.54
cmslwckms00eli5py17fvg1d9	医疗健康	title	对比	对比	我妈体检完说没事，回家就头晕加重”——家属常忽略的5个预警信号	\N	\N	f	ai	t	2026-08-09 14:27:19.54	2026-08-09 14:27:19.54
cmslwckms00emi5pyyaif0r4g	医疗健康	title	对比	对比	陪父亲做前列腺检查那天，我才懂什么叫“沉默的进展性疾病	\N	\N	f	ai	t	2026-08-09 14:27:19.541	2026-08-09 14:27:19.541
cmslwckmt00eni5pyk18ow05a	医疗健康	title	对比	对比	产科医生自己孕晚期坚持做的3项额外筛查，没写在常规产检单上	\N	\N	f	ai	t	2026-08-09 14:27:19.541	2026-08-09 14:27:19.541
cmslwckmt00eoi5pypkcbzgvo	医疗健康	title	对比	对比	女儿带奶奶来体检，发现她听力下降60%，却一直以为是“老糊涂	\N	\N	f	ai	t	2026-08-09 14:27:19.542	2026-08-09 14:27:19.542
cmslwckmu00epi5pypv941qhb	医疗健康	title	对比	对比	那位拒绝做肠镜的阿姨，三个月后确诊T1期——她最后悔没听医生这句话	\N	\N	f	ai	t	2026-08-09 14:27:19.542	2026-08-09 14:27:19.542
cmslwckmu00eqi5pyf1dj6p54	医疗健康	title	对比	对比	体检前72小时必须停用的5类常用药，第3种很多人天天在吃	\N	\N	f	ai	t	2026-08-09 14:27:19.543	2026-08-09 14:27:19.543
cmslwckmv00eri5pyhu3ugd2z	医疗健康	title	对比	对比	三甲医院健康管理中心公开的6步体检决策清单（附自评表）	\N	\N	f	ai	t	2026-08-09 14:27:19.543	2026-08-09 14:27:19.543
cmslwckmv00esi5py8cbkjok0	医疗健康	title	对比	对比	家庭体检避坑指南：给父母选项目时，这4个优先级顺序不能错	\N	\N	f	ai	t	2026-08-09 14:27:19.544	2026-08-09 14:27:19.544
cmslwckmw00eti5pycsaw57xk	医疗健康	title	对比	对比	医生不会主动告诉你的5个“体检加项”逻辑：按年龄/家族史/职业定制	\N	\N	f	ai	t	2026-08-09 14:27:19.545	2026-08-09 14:27:19.545
cmslwckmx00eui5py8fq8qvul	医疗健康	title	对比	对比	儿童青少年健康筛查必查清单：视力、脊柱、骨龄、微量元素、心理量表	\N	\N	f	ai	t	2026-08-09 14:27:19.546	2026-08-09 14:27:19.546
cmslwckmy00evi5pyeracbhyw	医疗健康	title	对比	对比	五一”假期后门诊爆满！消化科医生提醒：这3类不适别硬扛	\N	\N	f	ai	t	2026-08-09 14:27:19.547	2026-08-09 14:27:19.547
cmslwckmz00ewi5py4iubxihr	医疗健康	title	对比	对比	AI辅助阅片上线后，肺小结节检出率提升31%，但真正关键的是后续管理	\N	\N	f	ai	t	2026-08-09 14:27:19.547	2026-08-09 14:27:19.547
cmslwckn000exi5py43ffe7sx	医疗健康	title	对比	对比	HPV疫苗预约难？我们联合疾控开放「体检+接种」一站式通道（限号）	\N	\N	f	ai	t	2026-08-09 14:27:19.548	2026-08-09 14:27:19.548
cmslwckn000eyi5pynhredz31	医疗健康	title	对比	对比	春困、脱发、月经紊乱…可能是同一种代谢问题，体检能提前6个月发现	\N	\N	f	ai	t	2026-08-09 14:27:19.549	2026-08-09 14:27:19.549
cmslwckn100ezi5pyn71jnaw0	医疗健康	title	对比	对比	北京医保新政落地：这7类慢病相关体检项目纳入门诊报销范围	\N	\N	f	ai	t	2026-08-09 14:27:19.549	2026-08-09 14:27:19.549
cmslwckn100f0i5pya5d1j62u	医疗健康	title	对比	对比	普通体检中心查不出的早期肾损伤，三甲专科如何用两项尿检锁定？	\N	\N	f	ai	t	2026-08-09 14:27:19.55	2026-08-09 14:27:19.55
cmslwckn200f1i5py17n26ycb	医疗健康	title	对比	对比	同样查甲状腺，社区医院和三甲中心的检测方法差异在哪？	\N	\N	f	ai	t	2026-08-09 14:27:19.55	2026-08-09 14:27:19.55
cmslwckn200f2i5py27aa3320	医疗健康	title	对比	对比	胃肠镜 vs 便潜血+肿瘤标志物：哪种更适合45岁以上无症状人群？	\N	\N	f	ai	t	2026-08-09 14:27:19.551	2026-08-09 14:27:19.551
cmslwckn200f3i5pyny5gcd8n	医疗健康	title	对比	对比	体检中心提供的“专家解读”和三甲医院门诊解读，到底差在哪？	\N	\N	f	ai	t	2026-08-09 14:27:19.551	2026-08-09 14:27:19.551
cmslwckn300f4i5py7pont5rm	医疗健康	title	对比	对比	心电图正常≠心脏没问题：动态心电图、心脏超声、运动负荷试验怎么选？	\N	\N	f	ai	t	2026-08-09 14:27:19.551	2026-08-09 14:27:19.551
cmslwdm3e00f5i5py7tj2a9mm	医疗健康	article	新客引流	\N	\N	【新客引流】	\N	f	ai	t	2026-08-09 14:28:08.09	2026-08-09 14:28:08.09
cmslwdm3g00f6i5py3ls6vhna	医疗健康	article	老客复购	\N	\N	三甲医院执业医师团队坐诊，持证上岗率100%，所有医生均公示执业编号可查。首次到院享免费基础健康评估（含血压、BMI、体脂分析），无需预约，工作日随到随检。我们不做推销式体检，只提供个性化建议——您值得被专业、耐心地对待。	\N	f	ai	t	2026-08-09 14:28:08.092	2026-08-09 14:28:08.092
cmslwdm3h00f7i5pya3xgp6kc	医疗健康	article	产品种草	\N	\N	社区家庭医生签约服务开通中，凭本地居住证/社保卡即可申领专属健康档案。建档即赠《家庭常见症状自查指南》电子版+1次远程健康咨询。数据加密存储，全程隐私保护，您的健康信息，我们比您更谨慎。	\N	f	ai	t	2026-08-09 14:28:08.093	2026-08-09 14:28:08.093
cmslwdm3i00f8i5pybi8m8rka	医疗健康	article	客户见证	\N	\N	关注即送「亚健康初筛工具包」：含5分钟自测量表、饮食运动记录模板、三甲医院转诊绿色通道使用说明。所有内容由我院慢病管理中心临床营养师与全科医师联合编制，已服务超2.3万家庭。	\N	f	ai	t	2026-08-09 14:28:08.094	2026-08-09 14:28:08.094
cmslwdm3j00f9i5pys89qjkaa	医疗健康	article	节假日活动	\N	\N	【老客复购】	\N	f	ai	t	2026-08-09 14:28:08.096	2026-08-09 14:28:08.096
cmslwnfei0000i5hc374dxrhw	家装	title	数字	数字	装修省下8.6万的3个关键动作，我们客户实测有效	\N	\N	f	ai	t	2026-08-09 14:35:45.978	2026-08-09 14:35:45.978
cmslwdm3k00fai5pyqq5ij2vj	医疗健康	article	品牌故事	\N	\N	连续2年参与年度体检的客户，自动升级为“安心守护会员”：下次体检享优先预约权、报告解读延长至45分钟、3项核心指标异常时主动提醒复查。信任是长期关系，我们用持续服务回应这份托付。	\N	f	ai	t	2026-08-09 14:28:08.096	2026-08-09 14:28:08.096
cmslwdm3l00fbi5pytmet3xvr	医疗健康	article	上新公告	\N	\N	上一年度体检报告中任一指标持续异常者，可预约专属复检方案——由原主检医师一对一复核，同步提供生活方式干预建议（非诊疗行为）。不重复收费，不捆绑项目，只为帮您看得更清、管得更准。	\N	f	ai	t	2026-08-09 14:28:08.097	2026-08-09 14:28:08.097
cmslwdm3l00fci5pyd2289oul	医疗健康	article	优惠活动	\N	\N	老客户推荐亲友完成首次体检，双方各获100元健康基金（可用于挂号、营养咨询、康复理疗等院内服务）。推荐满3人，额外赠送家庭急救包（含医用纱布、止血带、消毒湿巾等，均为二类医疗器械备案产品）。	\N	f	ai	t	2026-08-09 14:28:08.098	2026-08-09 14:28:08.098
cmslwdm3m00fdi5py4tuxl2hy	医疗健康	article	知识科普	\N	\N	【产品种草】	\N	f	ai	t	2026-08-09 14:28:08.098	2026-08-09 14:28:08.098
cmslwdm3m00fei5pyw5k2uow4	医疗健康	article	互动话题	\N	\N	「胃肠早筛安心包」上线：含幽门螺杆菌呼气试验+粪便DNA检测（国家药监局认证试剂），无创、居家采样、3个工作日出报告。检测前后均有消化科医师视频解读，不是卖检测，而是帮您建立胃肠健康 baseline。	\N	f	ai	t	2026-08-09 14:28:08.099	2026-08-09 14:28:08.099
cmslwdm3n00ffi5py6n59ctw4	医疗健康	article	答疑辟谣	\N	\N	「女性全周期健康档案」支持按年龄段智能匹配：25-35岁侧重生殖内分泌与甲状腺筛查；35-45岁增加乳腺钼靶+骨密度初筛；45岁以上同步纳入更年期症状评估量表。所有项目均依据《中国妇女保健指南》动态更新。	\N	f	ai	t	2026-08-09 14:28:08.1	2026-08-09 14:28:08.1
cmslwdm3o00fgi5py68jdotj2	医疗健康	article	会员权益	\N	\N	「儿童生长发育跟踪计划」含身高体重百分位曲线绘制、骨龄X光片AI辅助分析（由放射科主治医师复核）、营养摄入结构评估。每季度生成成长趋势简报，家长端小程序实时查看，数据同步至社区儿保系统。	\N	f	ai	t	2026-08-09 14:28:08.1	2026-08-09 14:28:08.1
cmslwdm3o00fhi5pyto48x4s1	医疗健康	article	会员权益	\N	\N	【客户见证】	\N	f	ai	t	2026-08-09 14:28:08.101	2026-08-09 14:28:08.101
cmslwdm3p00fii5pysszgakcx	医疗健康	article	会员权益	\N	\N	（脱敏处理）张女士，42岁，2022年起每年在我院做深度体检。去年报告提示空腹血糖临界升高，营养科介入后3个月复查回归正常范围。“没有开药，只有可执行的饮食调整和运动节奏，这才是真正有用的健康管理。	\N	f	ai	t	2026-08-09 14:28:08.101	2026-08-09 14:28:08.101
cmslwdm3q00fji5py79izqrb7	医疗健康	article	会员权益	\N	\N	（脱敏处理）李先生，58岁，高血压服药5年。通过我院“用药依从性+家庭血压监测”双轨管理项目，半年内将晨起收缩压稳定控制在135mmHg以内。“护士每月上门校准血压计，医生根据真实数据调药，比单纯门诊问诊靠谱得多。	\N	f	ai	t	2026-08-09 14:28:08.102	2026-08-09 14:28:08.102
cmslwdm3r00fki5pyrttwp8yj	医疗健康	article	会员权益	\N	\N	（脱敏处理）陈妈妈，孩子7岁，反复过敏性鼻炎。参与我院儿童过敏原筛查+环境干预指导计划后，季节性发作频次下降60%。“医生没让我们‘必须用药’，而是教怎么清洁床单、选空气净化器、避开花粉高峰时段——这些细节才最实在。	\N	f	ai	t	2026-08-09 14:28:08.103	2026-08-09 14:28:08.103
cmslwdm3s00fli5pycynpehlo	医疗健康	article	会员权益	\N	\N	【节假日活动】	\N	f	ai	t	2026-08-09 14:28:08.104	2026-08-09 14:28:08.104
cmslwdm3t00fmi5pywhubbmcv	医疗健康	article	会员权益	\N	\N	中秋团圆季，“全家健康福袋”限时开放：2大1小家庭套餐含基础体检+中医体质辨识+节气养生茶饮包（药食同源配方，卫健委备案）。9月15日-30日报名，加赠定制艾草香囊（非遗工艺，独立灭菌包装）。	\N	f	ai	t	2026-08-09 14:28:08.105	2026-08-09 14:28:08.105
cmslwdm3t00fni5pybcwmuo4x	医疗健康	article	会员权益	\N	\N	国庆黄金周，“银龄关爱行动”启动：60岁以上长者凭身份证享免费认知功能初筛（MMSE量表+画钟测试）+跌倒风险评估。每日限30名额，含1次康复科现场平衡训练体验，所有服务由副主任护师带队执行。	\N	f	ai	t	2026-08-09 14:28:08.106	2026-08-09 14:28:08.106
cmslwdm3u00foi5py24zqctmv	医疗健康	article	会员权益	\N	\N	元旦焕新计划：“健康启动金”发放中——新注册会员即得200元无门槛健康基金，可用于体检、疫苗接种、中医调理等全品类服务；老会员完成年度健康目标（如规律运动100天），再返100元。	\N	f	ai	t	2026-08-09 14:28:08.106	2026-08-09 14:28:08.106
cmslwdm3v00fpi5py3bc64qss	医疗健康	article	会员权益	\N	\N	【品牌故事】	\N	f	ai	t	2026-08-09 14:28:08.107	2026-08-09 14:28:08.107
cmslwdm3w00fqi5pys87thvtt	医疗健康	article	会员权益	\N	\N	2008年汶川地震后，我院首批医疗队在临时帐篷里为村民做血压筛查。16年来，从应急救援到社区慢病管理，我们坚持“不以盈利为目的的基础健康服务”写入章程。现有家庭医生签约率达87.3%，覆盖12个街道。	\N	f	ai	t	2026-08-09 14:28:08.108	2026-08-09 14:28:08.108
cmslwdm3w00fri5pyr8zr4pp9	医疗健康	article	会员权益	\N	\N	创始人李明远主任医师，从医32年，曾任省级慢病防控专家组成员。他坚持每周二上午开放“无门槛健康咨询窗口”，不限科室、不设时限、不收挂号费——这个习惯，已持续11年，累计接待超4800人次。	\N	f	ai	t	2026-08-09 14:28:08.109	2026-08-09 14:28:08.109
cmslwdm3x00fsi5pyqm0sih4t	医疗健康	article	会员权益	\N	\N	2019年起，我院成为全市首家接入医保电子凭证全流程应用的民营医疗机构。所有检查检验结果同步上传至“浙里办·健康档案”，患者可自主授权家人查看。技术不是目的，让健康信息真正属于您，才是初心。	\N	f	ai	t	2026-08-09 14:28:08.11	2026-08-09 14:28:08.11
cmslwdm3y00fti5py7ymxcyyr	医疗健康	article	会员权益	\N	\N	【上新公告】	\N	f	ai	t	2026-08-09 14:28:08.111	2026-08-09 14:28:08.111
cmslwdm3z00fui5py2oz4vlnd	医疗健康	article	会员权益	\N	\N	全新引进西门子Atlan 1.5T磁共振设备，通过国家放射诊疗许可与电磁环境安全认证。采用静音扫描技术（噪音＜70分贝），支持儿童及幽闭恐惧症患者舒适检查。预约即享影像科主治医师前置沟通。	\N	f	ai	t	2026-08-09 14:28:08.111	2026-08-09 14:28:08.111
cmslwdm4000fvi5py1vgutgzz	医疗健康	article	会员权益	\N	\N	「职场肩颈舒缓计划」正式上线：含三维步态分析+肌电生物反馈训练+物理治疗师手法松解。单次体验价198元（原价380元），限首50名预约者。所有操作人员均持有康复医学中级职称证书。	\N	f	ai	t	2026-08-09 14:28:08.112	2026-08-09 14:28:08.112
cmslwdm4100fwi5py4b3u09pr	医疗健康	article	会员权益	\N	\N	「糖尿病风险精细化评估包」新增胰岛素抵抗指数（HOMA-IR）计算与肠道菌群代谢物关联解读模块。报告由内分泌科+临床微生物实验室联合出具，引用《中华糖尿病杂志》2023年最新参考区间。	\N	f	ai	t	2026-08-09 14:28:08.113	2026-08-09 14:28:08.113
cmslwdm4100fxi5pyv8sr4hjs	医疗健康	article	会员权益	\N	\N	【优惠活动】	\N	f	ai	t	2026-08-09 14:28:08.114	2026-08-09 14:28:08.114
cmslwnfem0001i5hc2hgnzhpe	家装	title	反差	反差	90㎡老房翻新只花12万？拆掉隔墙+重做水电后真相曝光	\N	\N	f	ai	t	2026-08-09 14:35:45.982	2026-08-09 14:35:45.982
cmslwdm4200fyi5pyh5c53g7m	医疗健康	article	会员权益	\N	\N	3·8妇女节特惠：女性专项体检套餐直降300元，含甲状腺超声、乳腺彩超、妇科分泌物微生态检测（NGS技术）。加1元换购《女性激素健康管理手册》（三甲医院妇科主编，正版ISBN出版物）。	\N	f	ai	t	2026-08-09 14:28:08.114	2026-08-09 14:28:08.114
cmslwdm4300fzi5pyp3gw2o6u	医疗健康	article	会员权益	\N	\N	暑期学生健康关怀月：在校学生凭学生证享“升学体检+视力深度评估+脊柱侧弯筛查”组合价598元（市场价960元）。所有视力检测使用国家标准对数视力表，脊柱筛查由康复科副主任医师现场操作。	\N	f	ai	t	2026-08-09 14:28:08.116	2026-08-09 14:28:08.116
cmslwdm4400g0i5py9by7w2s1	医疗健康	article	会员权益	\N	\N	世界睡眠日”限时福利：多导睡眠监测（PSG）套餐含整夜监测+呼吸事件AI识别+睡眠呼吸暂停风险分级报告，现价1280元（原价1880元）。报告由呼吸内科主治医师+神经内科副主任医师双签发。	\N	f	ai	t	2026-08-09 14:28:08.117	2026-08-09 14:28:08.117
cmslwdm4600g1i5pyt03mjcug	医疗健康	article	会员权益	\N	\N	【知识科普】	\N	f	ai	t	2026-08-09 14:28:08.118	2026-08-09 14:28:08.118
cmslwdm4700g2i5pyqborxuv6	医疗健康	article	会员权益	\N	\N	体检发现“甲状腺结节3级”，≠需要手术。据《甲状腺结节诊疗指南（2023版）》，3级结节恶性概率＜2%，建议6-12个月复查超声。过度干预反而增加焦虑与医疗负担——定期观察，才是科学选择。	\N	f	ai	t	2026-08-09 14:28:08.12	2026-08-09 14:28:08.12
cmslwdm4800g3i5py1aaf3cqx	医疗健康	article	会员权益	\N	\N	血脂正常就不用控油”是误区。临床数据显示，甘油三酯正常人群若每日烹调油＞25g，5年内非酒精性脂肪肝检出率升高3.2倍。健康用油不是看总量，而是看种类（优选山茶籽油、亚麻籽油）与方式（少煎炸）。	\N	f	ai	t	2026-08-09 14:28:08.121	2026-08-09 14:28:08.121
cmslwdm4900g4i5py0dhp8qf2	医疗健康	article	会员权益	\N	\N	儿童近视防控关键期在6-10岁。单纯配镜不能延缓进展，需结合户外活动时长（每日≥2小时）、读写姿势监督、用眼环境照度（≥300lux）三要素。我院视光中心提供免费光照度检测与家庭改造建议。	\N	f	ai	t	2026-08-09 14:28:08.121	2026-08-09 14:28:08.121
cmslwe1uy00g5i5pynxur2rwe	医疗健康	topic	\N	\N	春季过敏高发期：三甲医院耳鼻喉科主任详解“花粉症”与普通感冒的5个关键区别	\N	\N	f	ai	t	2026-08-09 14:28:28.522	2026-08-09 14:28:28.522
cmslwe1v000g6i5pykz768bus	医疗健康	topic	\N	\N	清明节前后：体检报告中“结节”频现，影像科医生教你如何科学分级随访	\N	\N	f	ai	t	2026-08-09 14:28:28.525	2026-08-09 14:28:28.525
cmslwe1v100g7i5py4p99k1gn	医疗健康	topic	\N	\N	3·15消费者权益日：体检机构怎么选？卫健委备案查询指南+资质查验三步法	\N	\N	f	ai	t	2026-08-09 14:28:28.526	2026-08-09 14:28:28.526
cmslwe1v200g8i5pygn1i8uyj	医疗健康	topic	\N	\N	春困不是懒！神经内科医生解读褪黑素、维生素B12与昼夜节律的真实作用机制	\N	\N	f	ai	t	2026-08-09 14:28:28.527	2026-08-09 14:28:28.527
cmslwe1v300g9i5py589g5o9w	医疗健康	topic	\N	\N	4月世界免疫周：儿童疫苗补种VS成人加强针，公卫医师列出家庭免疫缺口自查表	\N	\N	f	ai	t	2026-08-09 14:28:28.528	2026-08-09 14:28:28.528
cmslwe1v600gai5pyqyjq335q	医疗健康	topic	\N	\N	五一出行高峰前：旅行急救包清单（附三甲药房药师推荐的非处方药+禁忌提醒）	\N	\N	f	ai	t	2026-08-09 14:28:28.53	2026-08-09 14:28:28.53
cmslwe1v700gbi5py58xht6ub	医疗健康	topic	\N	\N	5月母亲节专题：乳腺超声报告里的BI-RADS分级，乳腺外科医生逐级解读临床意义	\N	\N	f	ai	t	2026-08-09 14:28:28.531	2026-08-09 14:28:28.531
cmslwe1v800gci5py2bovuphw	医疗健康	topic	\N	\N	高考季前置：青少年视力筛查常见误区——视光中心验光师澄清“散瞳伤眼”谣言	\N	\N	f	ai	t	2026-08-09 14:28:28.532	2026-08-09 14:28:28.532
cmslwe1v900gdi5pys9vf9cze	医疗健康	topic	\N	\N	6月全国爱眼日：OK镜、离焦镜、阿托品，眼科专家对比三种近视干预方式的适用边界	\N	\N	f	ai	t	2026-08-09 14:28:28.533	2026-08-09 14:28:28.533
cmslwe1va00gei5py5hhj1b8s	医疗健康	topic	\N	\N	梅雨季来临：霉菌性鼻炎和真菌性鼻窦炎如何区分？耳鼻喉科门诊真实病例拆解（脱敏）	\N	\N	f	ai	t	2026-08-09 14:28:28.534	2026-08-09 14:28:28.534
cmslwe1vb00gfi5pygwzlzxzs	医疗健康	topic	\N	\N	6·14世界献血者日：献血后“乏力头晕”是正常反应吗？血站医师详解生理恢复时间线	\N	\N	f	ai	t	2026-08-09 14:28:28.535	2026-08-09 14:28:28.535
cmslwe1vc00ggi5pyj6irroza	医疗健康	topic	\N	\N	暑期亲子健康：儿童幽门螺杆菌检测要不要做？消化科医生列出4类必须筛查指征	\N	\N	f	ai	t	2026-08-09 14:28:28.536	2026-08-09 14:28:28.536
cmslwe1vd00ghi5pyzi0zjli7	医疗健康	topic	\N	\N	7月高温预警：中暑分级标准（轻度/热衰竭/热射病）及急诊科现场处置流程实录	\N	\N	f	ai	t	2026-08-09 14:28:28.537	2026-08-09 14:28:28.537
cmslwe1ve00gii5pynfedqydu	医疗健康	topic	\N	\N	八一建军节特别策划：退役军人专属体检套餐设计逻辑——依据服役年限与兵种的差异化项目设置	\N	\N	f	ai	t	2026-08-09 14:28:28.538	2026-08-09 14:28:28.538
cmslwe1vf00gji5pyzl9kwfra	医疗健康	topic	\N	\N	立秋养生误区盘点：中医科主任指出“贴秋膘”不等于多吃肉，体质辨识才是前提	\N	\N	f	ai	t	2026-08-09 14:28:28.539	2026-08-09 14:28:28.539
cmslwe1vg00gki5pyubjwb2ik	医疗健康	topic	\N	\N	9月开学季：学生脊柱侧弯筛查进校园，骨科医生演示家庭自测“肩胛骨高低法	\N	\N	f	ai	t	2026-08-09 14:28:28.54	2026-08-09 14:28:28.54
cmslwe1vh00gli5pyw0jmyiwj	医疗健康	topic	\N	\N	世界阿尔茨海默病日（9月21日）：记忆力下降≠老年痴呆，神经内科列出可逆性病因清单	\N	\N	f	ai	t	2026-08-09 14:28:28.541	2026-08-09 14:28:28.541
cmslwe1vi00gmi5py0djk4p22	医疗健康	topic	\N	\N	中秋国庆双节前：胃肠镜预约高峰应对指南——内镜中心护士长分享错峰预约技巧	\N	\N	f	ai	t	2026-08-09 14:28:28.542	2026-08-09 14:28:28.542
cmslwe1vi00gni5pycp7tm43x	医疗健康	topic	\N	\N	10月世界精神卫生日：焦虑失眠别急着吃药，心理科医生推荐PHQ-4量表家庭自评法	\N	\N	f	ai	t	2026-08-09 14:28:28.543	2026-08-09 14:28:28.543
cmslwe1vj00goi5pyqhn5r034	医疗健康	topic	\N	\N	重阳节专题：老年人跌倒风险评估表（含平衡能力、用药史、居家环境3维度）	\N	\N	f	ai	t	2026-08-09 14:28:28.544	2026-08-09 14:28:28.544
cmslwe1vk00gpi5pylz19b6bm	医疗健康	topic	\N	\N	流感疫苗开打首周：疾控中心专家答疑——四价vs冻干鼻喷，不同年龄组接种优先级说明	\N	\N	f	ai	t	2026-08-09 14:28:28.545	2026-08-09 14:28:28.545
cmslwe1vl00gqi5pylob0l57r	医疗健康	topic	\N	\N	11月全国消防宣传日联动：医院火灾逃生路线图实拍+住院患者应急疏散实景演练纪实	\N	\N	f	ai	t	2026-08-09 14:28:28.545	2026-08-09 14:28:28.545
cmslwe1vm00gri5pymkcmih27	医疗健康	topic	\N	\N	11月世界糖尿病日：糖化血红蛋白（HbA1c）与空腹血糖差异解读，内分泌科医生划重点	\N	\N	f	ai	t	2026-08-09 14:28:28.546	2026-08-09 14:28:28.546
cmslwe1vn00gsi5pyufqijfq8	医疗健康	topic	\N	\N	冬季心梗高发期：胸痛≠胃病！胸痛中心发布《非典型心梗症状识别手册》（含女性/老年人特异性表现）	\N	\N	f	ai	t	2026-08-09 14:28:28.547	2026-08-09 14:28:28.547
cmslwe1vn00gti5pywi8ns317	医疗健康	topic	\N	\N	冬至节气科普：中医体质调理方案（阳虚/痰湿/气郁型）——三甲中医院治未病科真实调理案例（脱敏）	\N	\N	f	ai	t	2026-08-09 14:28:28.548	2026-08-09 14:28:28.548
cmslwe1vo00gui5pypmezhkzd	医疗健康	topic	\N	\N	元旦前健康复盘：年度体检异常指标追踪指南——检验科主任教你看懂“动态变化趋势	\N	\N	f	ai	t	2026-08-09 14:28:28.549	2026-08-09 14:28:28.549
cmslwe1vp00gvi5pylvojk0j0	医疗健康	topic	\N	\N	春节返乡潮：异地医保备案全流程图解（国家医保平台操作截图+常见失败原因排查）	\N	\N	f	ai	t	2026-08-09 14:28:28.549	2026-08-09 14:28:28.549
cmslwe1vq00gwi5pymx24s1nh	医疗健康	topic	\N	\N	寒假儿童生长发育门诊爆满：骨龄片怎么看？儿科内分泌医生解析X光片判读逻辑	\N	\N	f	ai	t	2026-08-09 14:28:28.55	2026-08-09 14:28:28.55
cmslwe1vr00gxi5pyhfjbajqr	医疗健康	topic	\N	\N	情人节特别企划：“备孕焦虑”影响受孕率？生殖医学科医生谈心理-内分泌双向调节机制	\N	\N	f	ai	t	2026-08-09 14:28:28.551	2026-08-09 14:28:28.551
cmslwe1vs00gyi5pyfc9ofd3o	医疗健康	topic	\N	\N	腊八节传统养生：体检发现“脂肪肝”还能喝腊八粥吗？营养科定制低GI版食谱（附热量标注）	\N	\N	f	ai	t	2026-08-09 14:28:28.552	2026-08-09 14:28:28.552
cmslwed5400gzi5pyiolw470w	医疗健康	image_prompt	\N	\N	\N	一张干净明亮的现代化体检中心前台实景照片，浅木色与灰白主色调，透明玻璃幕墙透出绿植，logo清晰可见，ins风柔焦+自然光	\N	f	ai	t	2026-08-09 14:28:43.145	2026-08-09 14:28:43.145
cmslwed5600h0i5pyuf5842u5	医疗健康	image_prompt	\N	\N	\N	一台高端进口全自动生化分析仪特写，金属质感机身反光柔和，屏幕显示“正在校准”界面，背景虚化为实验室环境，写实风格高清摄影	\N	f	ai	t	2026-08-09 14:28:43.147	2026-08-09 14:28:43.147
cmslwed5700h1i5py3ummkafs	医疗健康	image_prompt	\N	\N	\N	中医理疗区药柜与艾条陈列，青砖墙配烫金书法“未病先防”，竹编灯罩投下暖光，国潮风手绘质感+微颗粒纹理	\N	f	ai	t	2026-08-09 14:28:43.148	2026-08-09 14:28:43.148
cmslwed5800h2i5pypbhmtntu	医疗健康	image_prompt	\N	\N	\N	一间通透温馨的儿科诊室实景，阳光透过百叶窗洒在儿童绘本架和原木候诊椅上，墙上挂有手绘生长曲线图，ins风低饱和+胶片滤镜	\N	f	ai	t	2026-08-09 14:28:43.148	2026-08-09 14:28:43.148
cmslwed5900h3i5pyy8r72tpo	医疗健康	image_prompt	\N	\N	\N	三甲医院检验科工作场景：穿白大褂的检验师专注操作质谱仪，桌面整齐摆放带编号的样本管，背景可见ISO15189认证标识，写实风格纪实摄影	\N	f	ai	t	2026-08-09 14:28:43.149	2026-08-09 14:28:43.149
cmslwed5a00h4i5pyroa41rse	医疗健康	image_prompt	\N	\N	\N	社区健康小屋外景，红灯笼与“科学体检·安心守护”毛笔字横幅相映，门口排着有序等候的银发老人，国潮风水墨晕染+朱砂点缀	\N	f	ai	t	2026-08-09 14:28:43.15	2026-08-09 14:28:43.15
cmslwed5b00h5i5py67u196l2	医疗健康	image_prompt	\N	\N	\N	关爱女性健康”公益筛查活动海报：淡粉色渐变底，插画风女性剪影托起心形子宫结构简图，右下角印有卫健委指导单位LOGO，ins风扁平插画	\N	f	ai	t	2026-08-09 14:28:43.151	2026-08-09 14:28:43.151
cmslwed5b00h6i5pyuz36hp5u	医疗健康	image_prompt	\N	\N	\N	医院年度健康科普集市现场：志愿者向居民发放《体检报告解读手册》，展板展示“甲状腺结节良恶性鉴别要点”，写实风格新闻纪实抓拍	\N	f	ai	t	2026-08-09 14:28:43.152	2026-08-09 14:28:43.152
cmslwed5c00h7i5pyd9lat3r4	医疗健康	image_prompt	\N	\N	\N	重阳节义诊进社区海报：水墨山水背景中穿白大褂医生为老人测血压，祥云纹边框内嵌“公立三级医院专家团队”字样，国潮风烫金工艺感	\N	f	ai	t	2026-08-09 14:28:43.153	2026-08-09 14:28:43.153
cmslwed5d00h8i5pyawlvve9x	医疗健康	image_prompt	\N	\N	\N	脱敏处理的真实患者见证照：40岁女性手持体检报告微笑，报告关键页打码，背景为诊室绿植墙，左下角标注“2023年体检，已获本人授权”，ins风生活纪实	\N	f	ai	t	2026-08-09 14:28:43.153	2026-08-09 14:28:43.153
cmslwed5e00h9i5py5bky9orq	医疗健康	image_prompt	\N	\N	\N	康复科患者训练场景：中年男性在PT师指导下进行平衡训练，器械上贴有“国家二类医疗器械注册证号：××××”，写实风格现场跟拍	\N	f	ai	t	2026-08-09 14:28:43.154	2026-08-09 14:28:43.154
cmslwed5f00hai5pydislmrua	医疗健康	image_prompt	\N	\N	\N	社区慢病管理群成员合影（面部马赛克），手持“高血压规范管理达标证书”，背景墙有“三甲医院-社区卫生服务中心双向转诊协议”公示栏，国潮风年画构图	\N	f	ai	t	2026-08-09 14:28:43.155	2026-08-09 14:28:43.155
cmslwed5f00hbi5pych9dud8b	医疗健康	image_prompt	\N	\N	\N	清晨门诊大厅光影氛围图：阳光斜射在导医台大理石台面，一束干花与电子叫号屏同框，地面倒影清晰可见“仁心·精术”院训，ins风静帧电影感	\N	f	ai	t	2026-08-09 14:28:43.156	2026-08-09 14:28:43.156
cmslwed5g00hci5py2x8qazms	医疗健康	image_prompt	\N	\N	\N	深夜急诊科值班室真实场景：医生伏案书写病历，电脑旁放着咖啡杯与《内科学》第9版，窗外城市灯火微光，写实风格冷调纪实	\N	f	ai	t	2026-08-09 14:28:43.157	2026-08-09 14:28:43.157
cmslwed5h00hdi5pylbw2y92b	医疗健康	image_prompt	\N	\N	\N	中医药文化角氛围图：二十四节气养生转盘、铜制针灸人模型、宣纸卷轴写有“上医治未病”，朱砂印章盖于右下，国潮风工笔重彩+绢本质感	\N	f	ai	t	2026-08-09 14:28:43.157	2026-08-09 14:28:43.157
cmslwnfen0002i5hc3ztdjw35	家装	title	疑问	疑问	为什么87%的装修增项发生在木工阶段？监理现场记录全公开	\N	\N	f	ai	t	2026-08-09 14:35:45.983	2026-08-09 14:35:45.983
cmslwnfeo0003i5hc14w6spet	家装	title	痛点	痛点	“报价5万，结账12万”？我们把合同里隐藏的17处增项点全标红	\N	\N	f	ai	t	2026-08-09 14:35:45.985	2026-08-09 14:35:45.985
cmslwnfep0004i5hconnm82rf	家装	title	福利	福利	免费送！签约即赠《装修避坑验收手册》（含23个拍照验收节点）	\N	\N	f	ai	t	2026-08-09 14:35:45.986	2026-08-09 14:35:45.986
cmslwnfer0005i5hcrnlb3ee5	家装	title	权威数据	权威数据	中消协2024报告：家装纠纷中61.3%源于材料等级模糊——我们每种材料贴实物标签	\N	\N	f	ai	t	2026-08-09 14:35:45.987	2026-08-09 14:35:45.987
cmslwnfes0006i5hcvpsxr2my	家装	title	悬念	悬念	这个阳台改造方案，业主签完合同第3天就反悔…后来她发了条朋友圈	\N	\N	f	ai	t	2026-08-09 14:35:45.989	2026-08-09 14:35:45.989
cmslwnfeu0007i5hcphhya18b	家装	title	共情	共情	“我婆婆盯了37天工地，最后主动夸我们施工规范”｜真实客户录音节选	\N	\N	f	ai	t	2026-08-09 14:35:45.99	2026-08-09 14:35:45.99
cmslwnfev0008i5hc4v1arvtg	家装	title	故事	故事	从毛坯到入住，我家287天装修日记：第15天瓦工停工，我们这样处理	\N	\N	f	ai	t	2026-08-09 14:35:45.991	2026-08-09 14:35:45.991
cmslwnfew0009i5hcc67pmf40	家装	title	清单	清单	装修主材选购清单：瓷砖/地板/洁具/五金/涂料——品牌、型号、单价、验收标准全列清	\N	\N	f	ai	t	2026-08-09 14:35:45.992	2026-08-09 14:35:45.992
cmslwnfex000ai5hctauc0l7n	家装	title	热点	热点	《繁花》爆火后，上海老洋房翻新咨询量涨300%，我们接单后做了这3件事	\N	\N	f	ai	t	2026-08-09 14:35:45.993	2026-08-09 14:35:45.993
cmslwnfey000bi5hcc0t1mfz3	家装	title	对比	对比	同样是80㎡两居，别人装出“出租屋感”，我们装出“杂志封面感”	\N	\N	f	ai	t	2026-08-09 14:35:45.994	2026-08-09 14:35:45.994
cmslwnfey000ci5hcmrnsnbuh	家装	title	对比	对比	11个被装修公司隐瞒的报价陷阱，第9个连设计师都默认不提	\N	\N	f	ai	t	2026-08-09 14:35:45.995	2026-08-09 14:35:45.995
cmslwnfez000di5hclua16eti	家装	title	对比	对比	毛坯交付VS精装交付？我们帮客户退掉精装房重装，多住半年却省4.2万	\N	\N	f	ai	t	2026-08-09 14:35:45.996	2026-08-09 14:35:45.996
cmslwnff0000ei5hcvdneo70u	家装	title	对比	对比	装修到底要不要找设计师？3位从业12年的设计师坦白局	\N	\N	f	ai	t	2026-08-09 14:35:45.997	2026-08-09 14:35:45.997
cmslwnff2000fi5hcjmzjdixn	家装	title	对比	对比	“说好全包，结果踢脚线要另加钱”｜客户投诉后，我们把增项红线写进合同第一页	\N	\N	f	ai	t	2026-08-09 14:35:45.998	2026-08-09 14:35:45.998
cmslwnff3000gi5hcen1sql0j	家装	title	对比	对比	限时开放！本周预约量房，免费升级德国进口防潮石膏板（限前20户）	\N	\N	f	ai	t	2026-08-09 14:35:45.999	2026-08-09 14:35:45.999
cmslwnff3000hi5hcejtr2q3t	家装	title	对比	对比	上海市建委最新抽检：32家装修公司中，仅7家防水施工合格率超95%——我们连续18个月100%	\N	\N	f	ai	t	2026-08-09 14:35:46	2026-08-09 14:35:46
cmslwnff4000ii5hcr9g52det	家装	title	对比	对比	开工前夜，业主突然问：“你们工地能随时视频查看吗？”第二天我们就上线了直播系统	\N	\N	f	ai	t	2026-08-09 14:35:46.001	2026-08-09 14:35:46.001
cmslwnff5000ji5hcj1rkj84b	家装	title	对比	对比	“我妈在工地蹲点2小时，拍下工人用胶枪打满缝”｜这才是她放心签字的原因	\N	\N	f	ai	t	2026-08-09 14:35:46.001	2026-08-09 14:35:46.001
cmslwnff6000ki5hcyvt7m6x5	家装	title	对比	对比	我家装修第42天，拆开吊顶发现电线没穿管…后来我们拍下了整改全过程	\N	\N	f	ai	t	2026-08-09 14:35:46.002	2026-08-09 14:35:46.002
cmslwnff6000li5hcdtsyos59	家装	title	对比	对比	装修必查的15项隐蔽工程验收清单：水电/防水/吊顶/地暖/隔音——附带验收工具包	\N	\N	f	ai	t	2026-08-09 14:35:46.003	2026-08-09 14:35:46.003
cmslwnff7000mi5hctq2sscxw	家装	title	对比	对比	郑州暴雨后，我们回访了2023年做的37个防水工地，0渗漏，数据已公示	\N	\N	f	ai	t	2026-08-09 14:35:46.004	2026-08-09 14:35:46.004
cmslwnff8000ni5hc1lsyc691	家装	title	对比	对比	“第一次装修，我连水泥标号都不知道…”｜新手妈妈的12周装修成长手记	\N	\N	f	ai	t	2026-08-09 14:35:46.004	2026-08-09 14:35:46.004
cmslwnff9000oi5hcxuai0rql	家装	title	对比	对比	旧房翻新最怕什么？不是贵，是拆完才发现承重墙被砸过——我们标配墙体雷达扫描	\N	\N	f	ai	t	2026-08-09 14:35:46.005	2026-08-09 14:35:46.005
cmslwnffa000pi5hczsfk4hv6	家装	title	对比	对比	同样铺800×800瓷砖，别人用普通水泥砂浆，我们坚持用C2级瓷砖胶（成本高37%）	\N	\N	f	ai	t	2026-08-09 14:35:46.006	2026-08-09 14:35:46.006
cmslwnffa000qi5hcfiqvw6b2	家装	title	对比	对比	7个让装修预算失控的“小细节”，第5个90%业主签合同时没注意	\N	\N	f	ai	t	2026-08-09 14:35:46.007	2026-08-09 14:35:46.007
cmslwnffb000ri5hcxu1nbgce	家装	title	对比	对比	2023年我们拒接的142单装修：不是嫌贵，是发现客户户型存在结构性隐患	\N	\N	f	ai	t	2026-08-09 14:35:46.008	2026-08-09 14:35:46.008
cmslwnffc000si5hcmis31zge	家装	title	对比	对比	“你们敢不敢把材料进货单发给我？”——上周客户这句话，让我们连夜上线材料溯源系统	\N	\N	f	ai	t	2026-08-09 14:35:46.008	2026-08-09 14:35:46.008
cmslwnffc000ti5hcmwfp2jhi	家装	title	对比	对比	免费领！《装修材料真伪辨别指南》电子版（含12种主材扫码验货流程）	\N	\N	f	ai	t	2026-08-09 14:35:46.009	2026-08-09 14:35:46.009
cmslwnffd000ui5hczqsaae8l	家装	title	对比	对比	据住建部《住宅装修质量白皮书》，墙面空鼓率超3%即属不合格——我们承诺≤0.5%	\N	\N	f	ai	t	2026-08-09 14:35:46.009	2026-08-09 14:35:46.009
cmslwnffd000vi5hcbixztezz	家装	title	对比	对比	这位程序员爸爸做完装修后，给我们的监理写了份GitHub式施工日志	\N	\N	f	ai	t	2026-08-09 14:35:46.01	2026-08-09 14:35:46.01
cmslwnffe000wi5hc5o8j99sf	家装	title	对比	对比	去年装的这套房，今年租客续租时主动提出加租——因为卫生间干湿分离太好用	\N	\N	f	ai	t	2026-08-09 14:35:46.01	2026-08-09 14:35:46.01
cmslwnffe000xi5hcfgxi6h9p	家装	title	对比	对比	装修主材进场必核对的8张单据：检测报告/报关单/授权书/批次号/出厂日期/物流单/签收单/封样单	\N	\N	f	ai	t	2026-08-09 14:35:46.011	2026-08-09 14:35:46.011
cmslwnfff000yi5hc2gvqtevr	家装	title	对比	对比	杭州亚运会场馆同款抗菌涂料，我们批量采购后降价32%回馈老客户	\N	\N	f	ai	t	2026-08-09 14:35:46.011	2026-08-09 14:35:46.011
cmslwnfff000zi5hc1l1c46wj	家装	title	对比	对比	一起装修，别人家延期87天，我们提前11天交付｜工期延误按500元/天赔付写进合同	\N	\N	f	ai	t	2026-08-09 14:35:46.012	2026-08-09 14:35:46.012
cmslwnffg0010i5hc9x3gy1ly	家装	title	对比	对比	“报价单里‘其他费用’写了2800元，到底是什么？”我们把这笔钱拆解成13项明细	\N	\N	f	ai	t	2026-08-09 14:35:46.012	2026-08-09 14:35:46.012
cmslwnffg0011i5hc4djy885z	家装	title	对比	对比	为什么高端楼盘业主更爱找我们？不是便宜，是敢把所有工艺标准拍成1080P教学视频	\N	\N	f	ai	t	2026-08-09 14:35:46.013	2026-08-09 14:35:46.013
cmslwnffh0012i5hcsm1kp1p9	家装	title	对比	对比	客户说：“你们连垃圾清运车车牌号都让我拍照留证”｜这就是我们工地透明化的开始	\N	\N	f	ai	t	2026-08-09 14:35:46.013	2026-08-09 14:35:46.013
cmslwnffi0013i5hcw8cscdkk	家装	title	对比	对比	32岁二胎家庭装修全记录：从纠结儿童房配色，	\N	\N	f	ai	t	2026-08-09 14:35:46.014	2026-08-09 14:35:46.014
cmslwoded0014i5hc9keomlkh	家装	article	新客引流	\N	\N	新客引流：刚交房的业主别急着签合同！我们免费提供《装修避坑清单》+3次现场勘测，不收定金。上周在滨江樾府帮王女士避开8处隐蔽增项，连水电点位都标好尺寸。扫码领清单，还能预约本周六工地开放日——真正在建的毛坯到软装全过程，全程无剧本、无滤镜。	\N	f	ai	t	2026-08-09 14:36:30.036	2026-08-09 14:36:30.036
cmslwodee0015i5hc3takdmvk	家装	article	老客复购	\N	\N	新客引流：你刷到的每条“装修翻车”视频，背后都有没说出口的细节。我们整理了2024年杭州TOP50小区常见户型缺陷图谱，含承重墙误拆、地暖层高冲突等12类预警。留【小区名】免费发你专属版，附赠《装修公司黑名单自查表》。	\N	f	ai	t	2026-08-09 14:36:30.039	2026-08-09 14:36:30.039
cmslwodeg0016i5hc1q7xrhsi	家装	article	产品种草	\N	\N	新客引流：装修不是拼低价，是拼“谁敢把成本写进合同”。我们公开所有主材品牌型号+进货凭证编号，连美缝剂批号都能扫码查真伪。现在预约量房，送《报价单逐条解析指南》（含37个常被模糊表述的陷阱词对照表）。	\N	f	ai	t	2026-08-09 14:36:30.04	2026-08-09 14:36:30.04
cmslwodeh0017i5hc27ts0cc0	家装	article	客户见证	\N	\N	老客复购：李哥家2021年装的滨江时代花园，今年主动找我们做全屋焕新：墙面微水泥翻新+厨电升级+智能照明系统。他说：“当年验收时我拍的327张细节图，现在还能当新项目参考标准。”老客户复购享0元设计费+材料升级补贴2000元。	\N	f	ai	t	2026-08-09 14:36:30.041	2026-08-09 14:36:30.041
cmslwodei0018i5hc2184ot6a	家装	article	节假日活动	\N	\N	老客复购：上个月，西溪蝶园的陈姐带着闺蜜来签约——她家三年前装的极简风，至今没换过一块瓷砖、一扇柜门。“你们连踢脚线收口都用激光定位”，她说，“这次给爸妈装养老房，必须还是你们。”老带新双方各赠全屋保洁1次。	\N	f	ai	t	2026-08-09 14:36:30.043	2026-08-09 14:36:30.043
cmslwodej0019i5hc832lly3t	家装	article	品牌故事	\N	\N	老客复购：装修不是一锤子买卖，而是服务的开始。我们为交付满2年的客户免费提供《家居健康体检》：甲醛复测+五金松动排查+电路负载检测+排水坡度复查。已有412户完成回访，问题响应平均时效1.8天。	\N	f	ai	t	2026-08-09 14:36:30.044	2026-08-09 14:36:30.044
cmslwodek001ai5hcowy5vhjp	家装	article	上新公告	\N	\N	产品种草：实拍对比｜同一款爱格ENF级板，市面混用“国产基材+进口饰面”冒充原装进口。我们坚持整张板报关单+批次检测报告双公示，连封边胶品牌都写进合同附件。今天下单，送德国瑞好封边条防伪查询教程。	\N	f	ai	t	2026-08-09 14:36:30.045	2026-08-09 14:36:30.045
cmslwodel001bi5hcebwzstri	家装	article	优惠活动	\N	\N	产品种草：为什么我们坚持用立邦抗碱底漆+面漆组合？实测数据说话：在潮气重的地下室，普通底漆3个月泛碱，我们的组合撑过18个月无返工。所有工地用漆桶贴二维码，扫码看生产日期+批次质检报告。	\N	f	ai	t	2026-08-09 14:36:30.046	2026-08-09 14:36:30.046
cmslwodem001ci5hcb1cnl13b	家装	article	知识科普	\N	\N	产品种草：别再为“无醛添加”标签买单！真正安全的是ENF级+封闭工艺双保险。我们所有柜体板材均做UV固化封闭处理（比传统封边多1道工序），第三方检测报告显示甲醛释放量≤0.016mg/m³，仅为国标限值1/3。	\N	f	ai	t	2026-08-09 14:36:30.046	2026-08-09 14:36:30.046
cmslwoden001di5hct4yqcq9w	家装	article	互动话题	\N	\N	客户见证：拱墅区赵女士发来手写感谢信：“他们连我家猫爬架承重梁都做了结构验算，图纸盖了设计院章。”验收当天，她拿着我们给的《127项验收对照表》逐条打钩，3处整改全部2小时内闭环。	\N	f	ai	t	2026-08-09 14:36:30.047	2026-08-09 14:36:30.047
cmslwodeo001ei5hc1ohm3ojf	家装	article	答疑辟谣	\N	\N	客户见证：95后小夫妻在抖音晒出装修日记：“从报价单第一页‘拆除费’开始，我们就知道没找错人——他们把砸墙产生的建筑垃圾清运费用、临时围挡费用、降噪措施费用全拆开列，连城管报备费都写了依据。	\N	f	ai	t	2026-08-09 14:36:30.048	2026-08-09 14:36:30.048
cmslwodep001fi5hc43otyib6	家装	article	会员权益	\N	\N	客户见证：余杭未来科技城刘先生说：“最打动我的不是效果图多漂亮，是工人师傅蹲在地上给我演示柜内灯带如何避免频闪——他掏出手机慢动作拍给我看，还教我用APP调色温。	\N	f	ai	t	2026-08-09 14:36:30.049	2026-08-09 14:36:30.049
cmslwodeq001gi5hcxecsnj77	家装	article	会员权益	\N	\N	节假日活动：五一不放假，但施工不停工！4.28-5.5期间签约，享三重保障：①工期延误按500元/天赔偿（写进合同）②主材涨价差额由我们承担③赠送价值1980元全屋智能开关套装（含离家模式预设）。	\N	f	ai	t	2026-08-09 14:36:30.051	2026-08-09 14:36:30.051
cmslwodes001hi5hccg73y11a	家装	article	会员权益	\N	\N	节假日活动：端午安康不只说说而已！6月1日-10日签约客户，除常规优惠外，额外获赠：①定制艾草香囊（绣客户姓名）②厨房防滑垫（加厚硅胶+纳米疏水层）③儿童房圆角保护套套装（适配所有家具）。	\N	f	ai	t	2026-08-09 14:36:30.052	2026-08-09 14:36:30.052
cmslwodet001ii5hcb51jb4gc	家装	article	会员权益	\N	\N	节假日活动：中秋团圆季，装修也讲“圆满”。9.10-9.17签约，主材升级不加价：圣象地板升至SPC石塑层+木纹层双复合款；欧派橱柜升级铝框吸塑门板+缓冲铰链；另赠全家福拍摄服务（含精修9张）。	\N	f	ai	t	2026-08-09 14:36:30.053	2026-08-09 14:36:30.053
cmslwodet001ji5hc9n35r1zo	家装	article	会员权益	\N	\N	品牌故事：2015年，我们在凤起路一个8㎡办公室接下第一单——帮退休教师翻新老破小。没有样板间，就带客户逛正在施工的工地；没有营销预算，靠每张验收单背面手写施工日记。如今团队67人，但“验收单手写备注”仍是铁律。	\N	f	ai	t	2026-08-09 14:36:30.054	2026-08-09 14:36:30.054
cmslwodeu001ki5hcos8yelxz	家装	article	会员权益	\N	\N	品牌故事：创始人老周干了22年工长，2018年痛心于同行用“特价砖”糊弄客户，干脆自己跑佛山挑厂、盯窑炉、验出厂报告。现在我们仓库里每片瓷砖都有独立身份证，扫码可见烧制温度曲线和吸水率实测值。	\N	f	ai	t	2026-08-09 14:36:30.055	2026-08-09 14:36:30.055
cmslwodev001li5hc6k5rfbgj	家装	article	会员权益	\N	\N	品牌故事：2020年疫情封控期，我们给每位待开工客户寄去“安心包”：含消毒湿巾、N95口罩、施工进度手账本，还有张手绘卡片：“您放心隔离，我们远程盯工地——每日3段无剪辑视频+定位打卡截图。	\N	f	ai	t	2026-08-09 14:36:30.056	2026-08-09 14:36:30.056
cmslwodew001mi5hcrixp821h	家装	article	会员权益	\N	\N	上新公告：即日起，「适老焕新」专项服务上线！含：①全屋无障碍坡道定制（承重计算书备案）②适老化卫浴套装（恒温龙头+防滑扶手+坐浴椅承重认证）③紧急呼叫系统（直连社区物业+家属手机）。首批15户享免费适老评估。	\N	f	ai	t	2026-08-09 14:36:30.057	2026-08-09 14:36:30.057
cmslwodex001ni5hcqtordbe6	家装	article	会员权益	\N	\N	上新公告：全新「轻智能家装」套餐发布：不拉明线、不改结构，3小时快装全屋智能。含：毫米波人体感应灯（误触发率＜0.3%）、无线无电池门窗传感器（续航5年）、语音中控面板（支持方言识别）。所有设备接入米家/苹果HomeKit。	\N	f	ai	t	2026-08-09 14:36:30.058	2026-08-09 14:36:30.058
cmslwodez001oi5hcpi7atfzz	家装	article	会员权益	\N	\N	上新公告：行业首个「儿童房健康系统」落地：①墙面采用光触媒净醛涂料（TVOC分解率92.7%）②地板加铺0.8mm静音垫（Ldn≤19dB）③定制学习桌配蓝光过滤台灯（照度均匀度＞0.8）。每套房出具SGS儿童友好认证报告。	\N	f	ai	t	2026-08-09 14:36:30.06	2026-08-09 14:36:30.06
cmslwodf0001pi5hcluuh287r	家装	article	会员权益	\N	\N	优惠活动：618不玩套路！所有优惠直接减：①设计费直降3000元（非抵扣券）②主材套餐立减8%（不与其他折扣同享）③施工费锁定2024年基准价（合同注明，涨价不补差）。三重减免同步生效。	\N	f	ai	t	2026-08-09 14:36:30.061	2026-08-09 14:36:30.061
cmslwodf1001qi5hcgjkg4ky2	家装	article	会员权益	\N	\N	优惠活动：双11装修节，我们把“保价”做到极致：签约后若遇材料降价，差价双倍返还；若竞品同条件报价更低，补足差额+赠全屋除醛。所有承诺白纸黑字写进补充协议第7条。	\N	f	ai	t	2026-08-09 14:36:30.062	2026-08-09 14:36:30.062
cmslwodf2001ri5hch3ify0zx	家装	article	会员权益	\N	\N	优惠活动：年终清仓不等于清库存！精选2023年余量进口板材（爱格/克诺斯邦），批次检测报告齐全，单价直降35%，但仅开放30套。每套附赠《余量材料溯源卡》，含入库日期、仓储温湿度记录、复检合格证。	\N	f	ai	t	2026-08-09 14:36:30.063	2026-08-09 14:36:30.063
cmslwodf3001si5hc2wrzkhzx	家装	article	会员权益	\N	\N	知识科普：水电验收别只看打压测试！真正关键的是：①冷热水管间距≥15cm（防结露）②线管弯头弧度≥6D（避免穿线损伤）③强弱电交叉处加金属屏蔽层（防信号干扰）。我们工地每处都贴验收标牌，扫码看施工规范原文。	\N	f	ai	t	2026-08-09 14:36:30.064	2026-08-09 14:36:30.064
cmslwodf4001ti5hcteg6vdoz	家装	article	会员权益	\N	\N	知识科普：瓷砖空鼓≠质量问题！国家允许≤5%面积空鼓（单片砖≤5cm²），但厨卫必须0空鼓。我们采用“双涂法+振动压实”，并用红外热成像仪全屋扫描（空鼓区域显红色），报告留存至保修期结束。	\N	f	ai	t	2026-08-09 14:36:30.065	2026-08-09 14:36:30.065
cmslwodf5001ui5hcyk0fpdna	家装	article	会员权益	\N	\N	知识科普：所谓“全屋定制免费设计”，90%藏着3个隐形收费点：①异形柜体加收结构费②见光板单独计价③五金升级按件收费。我们设计阶段就提供《定制柜费用透明清单》，连抽屉轨道类型都提前确认。	\N	f	ai	t	2026-08-09 14:36:30.066	2026-08-09 14:36:30.066
cmslwodf6001vi5hcb2011awy	家装	article	会员权益	\N	\N	互动话题：你家装修最想解决的1个“生活痛点”是什么？插座不够？收纳总乱？孩子在家磕碰多？评论区留言，抽10位送《个性化痛点改造方案》（含3D示意图+施工节点图+材料清单）。	\N	f	ai	t	2026-08-09 14:36:30.066	2026-08-09 14:36:30.066
cmslwodf7001wi5hchxr31ugf	家装	article	会员权益	\N	\N	互动话题：装修时哪些“听起来合理”的建议，其实暗藏风险？比如“让瓦工师傅顺便贴背景墙”“用剩的涂料刷次卧”……分享你的踩坑经历，点赞前3名送《装修话术识别手册》（含28个高频误导话术拆解）。	\N	f	ai	t	2026-08-09 14:36:30.067	2026-08-09 14:36:30.067
cmslwodf8001xi5hcatlav010	家装	article	会员权益	\N	\N	互动话题：如果给你一次重装机会，你会优先升级家里哪个空间？厨房？卫生间？儿童房？还是阳台？投票选TOP3，我们将针对得票最高空间，下周直播拆解真实改造案例（含成本明细+工期倒推）。	\N	f	ai	t	2026-08-09 14:36:30.069	2026-08-09 14:36:30.069
cmslwodf9001yi5hcebkrzxl7	家装	article	会员权益	\N	\N	答疑辟谣：辟谣｜“进口板材一定比国产好”？错！国产兔宝宝ENF板甲醛释放量0.012mg/m³，优于部分进口板0.025mg/m³。关键看检测报告CMA章+批次号，不是产地。我们所有板材检测报告官网可查。	\N	f	ai	t	2026-08-09 14:36:30.07	2026-08-09 14:36:30.07
cmslwodfb001zi5hc67makui4	家装	article	会员权益	\N	\N	答疑辟谣：辟谣｜“装修完通风3个月就能住”？甲醛释放周期达3-15年，通风只能降低游离态。真正有效的是：①源头控制（ENF级材料）②温湿度调控（加速释放）③专业治理（封闭+分解）。我们交付前强制72小时恒温恒湿释放+治理。	\N	f	ai	t	2026-08-09 14:36:30.072	2026-08-09 14:36:30.072
cmslwodfc0020i5hcrcw3kaft	家装	article	会员权益	\N	\N	答疑辟谣：辟谣｜“监理公司比装修公司更公正”？多数第三方监理按天收费，易与施工方形成默契。我们实行“双监理制”：自有工程经理+客户授权的亲友监理（提供监理培训包），整改指令权归客户。	\N	f	ai	t	2026-08-09 14:36:30.073	2026-08-09 14:36:30.073
cmslwodfd0021i5hcjnh8u01l	家装	article	会员权益	\N	\N	会员权益：「安心家」会员三大特权：①终身免费图纸存档（含原始CAD+水电定位图）②每年1次全屋深度保养（含五金润滑、铰链调试、轨道清洁）③老客户专属材料池（爱格/大亚等品牌余量优价通道，价格低于市场	\N	f	ai	t	2026-08-09 14:36:30.074	2026-08-09 14:36:30.074
cmslworop0022i5hchmo1oi5x	家装	topic	\N	\N	春节后装修旺季开启：为什么今年超60%业主选择「先验房再签约」？我们拆解了3个真实案例的验房清单	\N	\N	f	ai	t	2026-08-09 14:36:48.552	2026-08-09 14:36:48.552
cmslworor0023i5hchhh7iwwo	家装	topic	\N	\N	情人节特辑：95后夫妻爆改婚房，把15㎡次卧改成双人书房+客卧，附全部尺寸图与报价明细	\N	\N	f	ai	t	2026-08-09 14:36:48.556	2026-08-09 14:36:48.556
cmslworot0024i5hcyt2oecm9	家装	topic	\N	\N	清明前后防潮关键期：南方业主必看！我们实测5种墙面防潮工艺，成本差2倍但效果差10年	\N	\N	f	ai	t	2026-08-09 14:36:48.557	2026-08-09 14:36:48.557
cmslworou0025i5hcelvfobn6	家装	topic	\N	\N	五一前装修避坑指南：装修公司不敢告诉你的「3个增项高发节点」（水电定位/瓷砖铺贴/吊顶收口）	\N	\N	f	ai	t	2026-08-09 14:36:48.558	2026-08-09 14:36:48.558
cmslworov0026i5hcnb8w4c2l	家装	topic	\N	\N	儿童节前夕发布：二胎家庭翻新记——如何用8.2万把72㎡老房改出3个独立学习区？图纸全公开	\N	\N	f	ai	t	2026-08-09 14:36:48.559	2026-08-09 14:36:48.559
cmslworow0027i5hcxl4v20x0	家装	topic	\N	\N	高考结束季：高三毕业生房间改造实录｜从压抑书桌到阳光自习角，收纳+护眼+隔音三合一方案	\N	\N	f	ai	t	2026-08-09 14:36:48.56	2026-08-09 14:36:48.56
cmslworox0028i5hc7rou5eeh	家装	topic	\N	\N	端午节工地直播：我们在施工现场包粽子，顺便带你看「防水闭水试验第48小时」真实水位线	\N	\N	f	ai	t	2026-08-09 14:36:48.561	2026-08-09 14:36:48.561
cmslworoy0029i5hcrwm7eqbe	家装	topic	\N	\N	暑期装修高峰预警：为什么今年超半数客户要求「全程视频监工」？我们上线了工地AI巡检系统	\N	\N	f	ai	t	2026-08-09 14:36:48.562	2026-08-09 14:36:48.562
cmslworoz002ai5hc9s3kzmrq	家装	topic	\N	\N	七夕策划：装修中的爱情考验｜一对结婚8年的夫妻，因「要不要砸掉主卧飘窗」吵了3周…最后这样解决	\N	\N	f	ai	t	2026-08-09 14:36:48.564	2026-08-09 14:36:48.564
cmslworp0002bi5hcplpsqyin	家装	topic	\N	\N	立秋装修黄金期启动：老房翻新必做的「结构安全体检」清单（含承重墙识别图+梁柱检测点位）	\N	\N	f	ai	t	2026-08-09 14:36:48.565	2026-08-09 14:36:48.565
cmslworp2002ci5hchebog3sk	家装	topic	\N	\N	教师节专题：为小学老师家改造儿童房，我们把「作业动线」做成设计核心——书包→书桌→床→衣柜闭环	\N	\N	f	ai	t	2026-08-09 14:36:48.567	2026-08-09 14:36:48.567
cmslworp3002di5hceqhcn1n0	家装	topic	\N	\N	中秋前交付案例：90天完工的120㎡精装房翻新，全程无增项，所有材料进场扫码查真伪	\N	\N	f	ai	t	2026-08-09 14:36:48.568	2026-08-09 14:36:48.568
cmslworp5002ei5hcc0wonbwn	家装	topic	\N	\N	国庆长假装修冷知识：为什么假期里工人反而更靠谱？我们统计了近3年工期履约率数据	\N	\N	f	ai	t	2026-08-09 14:36:48.569	2026-08-09 14:36:48.569
cmslworp6002fi5hcuozruntq	家装	topic	\N	\N	双11家装真相：我们把「爆款套餐」拆开称重——同款瓷砖实际厚度差0.8mm，影响寿命8年以上	\N	\N	f	ai	t	2026-08-09 14:36:48.57	2026-08-09 14:36:48.57
cmslworp8002gi5hc3n5z9875	家装	topic	\N	\N	小雪节气防冻指南：北方集中供暖前必做的5项隐蔽工程检查（含地暖分水器压力测试视频）	\N	\N	f	ai	t	2026-08-09 14:36:48.572	2026-08-09 14:36:48.572
cmslworp9002hi5hc0luloda6	家装	topic	\N	\N	元旦焕新计划：2025年最火的3种「低预算高颜值」改造方式（旧柜门翻新/灯光系统升级/踢脚线换装）	\N	\N	f	ai	t	2026-08-09 14:36:48.573	2026-08-09 14:36:48.573
cmslworpa002ii5hcfm3falxs	家装	topic	\N	\N	春节返乡潮来临：县城自建房装修避坑手册｜农村施工队vs城市品牌公司，这7项必须写进合同	\N	\N	f	ai	t	2026-08-09 14:36:48.575	2026-08-09 14:36:48.575
cmslworpc002ji5hcn5n8tjfh	家装	topic	\N	\N	情人节第二弹：装修中的「情绪价值」设计｜玄关留1米长凳、厨房设双动线、卫生间加阅读灯…细节清单	\N	\N	f	ai	t	2026-08-09 14:36:48.576	2026-08-09 14:36:48.576
cmslworpd002ki5hcx9xcfa3v	家装	topic	\N	\N	315消费者日深度报告：我们暗访12家材料商，曝光「E0级板材」真实甲醛释放值对比表	\N	\N	f	ai	t	2026-08-09 14:36:48.577	2026-08-09 14:36:48.577
cmslworpe002li5hc58wf2b9w	家装	topic	\N	\N	清明踏青季联动：阳台改造成「微型花园客厅」，附耐阴植物清单+排水改造示意图+承重测算过程	\N	\N	f	ai	t	2026-08-09 14:36:48.579	2026-08-09 14:36:48.579
cmslworpg002mi5hcumltfqnz	家装	topic	\N	\N	五一劳动节致敬：记录一位9年工龄水电工的每日工作清单（含他拒绝的3次违规改管请求）	\N	\N	f	ai	t	2026-08-09 14:36:48.58	2026-08-09 14:36:48.58
cmslworph002ni5hcwucxnmol	家装	topic	\N	\N	儿童节第二期：幼儿园老师家的「防撞安全系统」全解析｜圆角处理半径≥25mm、插座高度85cm、门缝≤3mm	\N	\N	f	ai	t	2026-08-09 14:36:48.582	2026-08-09 14:36:48.582
cmslworpj002oi5hcauvqd17x	家装	topic	\N	\N	端午龙舟热借势：老小区加装电梯后，如何重新规划垂直动线？我们做了3户实测动线模拟图	\N	\N	f	ai	t	2026-08-09 14:36:48.583	2026-08-09 14:36:48.583
cmslworpk002pi5hcrfj6riaj	家装	topic	\N	\N	七夕情感向：装修吵架最多的问题TOP5｜我们收集217份问卷，给出「决策分工表」模板（谁定颜色/谁选五金/谁验收）	\N	\N	f	ai	t	2026-08-09 14:36:48.585	2026-08-09 14:36:48.585
cmslworpl002qi5hc87zuof3i	家装	topic	\N	\N	立秋后除醛黄金期：不是所有活性炭都有效！我们委托第三方检测3款网红除醛产品真实数据	\N	\N	f	ai	t	2026-08-09 14:36:48.586	2026-08-09 14:36:48.586
cmslworpm002ri5hcb11222k5	家装	topic	\N	\N	教师节第二期：把书房变成「家庭教研室」——黑板墙+可升降书桌+论文资料智能归档系统实装记录	\N	\N	f	ai	t	2026-08-09 14:36:48.587	2026-08-09 14:36:48.587
cmslworpn002si5hc9n07yqc6	家装	topic	\N	\N	中秋团圆场景：餐厅扩容改造案例｜6人餐桌变伸缩式12人位，不拆墙不改管线，附施工前后承重测算	\N	\N	f	ai	t	2026-08-09 14:36:48.588	2026-08-09 14:36:48.588
cmslworpo002ti5hctt8apfuq	家装	topic	\N	\N	双11理性消费：我们把「全屋定制」报价单逐项拆解——1㎡柜体里藏着的7项隐形成本	\N	\N	f	ai	t	2026-08-09 14:36:48.589	2026-08-09 14:36:48.589
cmslworpp002ui5hc1x2jt20j	家装	topic	\N	\N	小雪节气实拍：北方极寒天气下，门窗安装的「4℃临界温度」施工规范（附红外热成像对比图）	\N	\N	f	ai	t	2026-08-09 14:36:48.589	2026-08-09 14:36:48.589
cmslworpq002vi5hc08k1gq8f	家装	topic	\N	\N	跨年焕新：2024年最后100天，我们帮3户家庭完成「轻量翻新」——只换地板+刷墙+换灯，平均耗时12天	\N	\N	f	ai	t	2026-08-09 14:36:48.591	2026-08-09 14:36:48.591
cmslwp3lg002wi5hczbg9tc25	家装	image_prompt	\N	\N	\N	一张现代简约风格的全屋定制橱柜产品展示图，ins风，浅灰+奶白配色，柔光自然窗景，大理石台面反光细腻，绿植点缀，俯拍构图，干净留白，氛围温馨高级	\N	f	ai	t	2026-08-09 14:37:03.987	2026-08-09 14:37:03.987
cmslwp3li002xi5hc01n91lio	家装	image_prompt	\N	\N	\N	一张真实工地现场的全屋定制橱柜安装实景图，写实风格，工人正在拧紧铰链，木纹柜门清晰可见，背景有未完工墙面和测量卷尺，光线自然偏冷调，细节真实有质感	\N	f	ai	t	2026-08-09 14:37:03.99	2026-08-09 14:37:03.99
cmslwp3lj002yi5hcq185gm53	家装	image_prompt	\N	\N	\N	一张中式厨房橱柜产品展示图，国潮风格，朱砂红与檀木色撞色，铜质拉手雕花祥云纹，背景为水墨山峦壁纸，灯笼光影柔和，对称构图，传统纹样元素融入现代功能设计	\N	f	ai	t	2026-08-09 14:37:03.992	2026-08-09 14:37:03.992
cmslwp3lk002zi5hcgjwtf1cz	家装	image_prompt	\N	\N	\N	一家位于城市核心商圈的家装公司实体门店外立面图，ins风，浅米色外墙搭配藤编LOGO招牌，玻璃门透出室内绿植与原木展架，午后阳光斜射，街道干净无车，生活感松弛	\N	f	ai	t	2026-08-09 14:37:03.993	2026-08-09 14:37:03.993
cmslwp3lm0030i5hc4xoi6mc5	家装	image_prompt	\N	\N	\N	一家家装公司门店内部接待区实景图，写实风格，前台工作人员正微笑着递上方案册，背景墙挂满施工许可证与材料检测报告，沙发旁堆着真实板材样板，镜头略带广角，体现空间秩序与专业感	\N	f	ai	t	2026-08-09 14:37:03.994	2026-08-09 14:37:03.994
cmslwp3ln0031i5hcjkbdfsxn	家装	image_prompt	\N	\N	\N	一家新中式风格家装门店门头设计图，国潮风格，青砖墙配鎏金匾额“匠心筑家”，两侧立柱绘有简化版《营造法式》纹样，檐下悬挂纸灯笼，暖光映照，兼具文化厚度与商业识别度	\N	f	ai	t	2026-08-09 14:37:03.995	2026-08-09 14:37:03.995
cmslwp3lo0032i5hcbvckcsoy	家装	image_prompt	\N	\N	\N	一张“春季焕新节”家装促销活动主视觉海报，ins风，马卡龙粉蓝渐变底色，手绘风格家具图标环绕中央“0增项承诺”毛笔字，角落有小猫蜷在软装样品上，轻盈治愈有记忆点	\N	f	ai	t	2026-08-09 14:37:03.997	2026-08-09 14:37:03.997
cmslwp3lq0033i5hc38u8mzjm	家装	image_prompt	\N	\N	\N	一张真实家装团购活动现场照片，写实风格，数十位业主手持签约单排队咨询，背景横幅印“全程透明报价表可查”，桌上摊开材料价目册与合同范本，闪光灯捕捉即时互动感	\N	f	ai	t	2026-08-09 14:37:03.999	2026-08-09 14:37:03.999
cmslwp3ls0034i5hczriof8r4	家装	image_prompt	\N	\N	\N	一张“端午安居节”活动海报，国潮风格，粽叶纹理底纹，龙舟造型报价单飞入画面，AR扫码图标化作锦鲤跃出水面，主标“一口价·全包不加钱”用汉简字体，喜庆不失可信	\N	f	ai	t	2026-08-09 14:37:04	2026-08-09 14:37:04
cmslwp3lt0035i5hcsbhud2jw	家装	image_prompt	\N	\N	\N	一套89㎡老房翻新前后对比图（左旧右新），ins风，统一柔焦滤镜，旧图泛黄带裂痕墙皮与锈蚀水管，新图为奶油风客厅：弧形沙发、悬浮电视柜、无主灯设计，窗边琴叶榕生机盎然，构图严格对称	\N	f	ai	t	2026-08-09 14:37:04.001	2026-08-09 14:37:04.001
cmslwp3lu0036i5hctmnmat7b	家装	image_prompt	\N	\N	\N	一套二手房改造客户实景案例图，写实风格，中年夫妻站在刚交付的开放式厨房中微笑击掌，妻子手拿验收清单特写（标注“瓷砖品牌/型号/铺贴工艺”），背后冰箱贴满孩子画作，生活痕迹真实可感	\N	f	ai	t	2026-08-09 14:37:04.002	2026-08-09 14:37:04.002
cmslwp3lv0037i5hcqrwx7v1o	家装	image_prompt	\N	\N	\N	一套苏州老宅改造案例图，国潮风格，粉墙黛瓦庭院与室内宋式家具呼应，新风系统隐藏于格栅天花，茶席旁手机显示“材料溯源码已扫码验证”，水墨晕染过渡框分隔古今，文化自信与科技透明并存	\N	f	ai	t	2026-08-09 14:37:04.004	2026-08-09 14:37:04.004
cmslwp3lx0038i5hc3x6s5nvs	家装	image_prompt	\N	\N	\N	一张冬日傍晚的精装交付样板间氛围图，ins风，暖光落地灯+壁炉微火，羊绒毯垂落于橡木地板，窗外飘雪虚化，茶几上放着手写感谢卡与钥匙串，静谧治愈，激发“这就是我家”的代入感	\N	f	ai	t	2026-08-09 14:37:04.005	2026-08-09 14:37:04.005
cmslwp3ly0039i5hcsjctm4vg	家装	image_prompt	\N	\N	\N	一张夏日清晨的儿童房实拍图，写实风格，阳光透过百叶窗在拼接地板投下条纹光斑，防撞桌角、可升降书桌、环保漆墙面标签清晰可见，床头贴着孩子手绘“我的房间”涂鸦，细节经得起放大审视	\N	f	ai	t	2026-08-09 14:37:04.006	2026-08-09 14:37:04.006
cmslwp3lz003ai5hcjk9ithhk	家装	image_prompt	\N	\N	\N	一张秋日黄昏的新婚家氛围图，国潮风格，柿红丝绒沙发配青瓷花器，背景书法轴“居之安”三字，智能面板显示“地暖22℃/PM2.5=8”，窗棂剪影融入二十四节气小图标，传统美学与现代人居无缝融合	\N	f	ai	t	2026-08-09 14:37:04.007	2026-08-09 14:37:04.007
cmslwphs3003bi5hc7m4y94z2	汽车后市场	title	数字	数字	3年没换刹车油？90%车主不知道它正在腐蚀你的制动系统	\N	\N	f	ai	t	2026-08-09 14:37:22.369	2026-08-09 14:37:22.369
cmslwphs6003ci5hcrvo2ipoo	汽车后市场	title	反差	反差	4S店报价899元的机油保养，我们只收299还送全车检测	\N	\N	f	ai	t	2026-08-09 14:37:22.374	2026-08-09 14:37:22.374
cmslwphs8003di5hcyu46xmk3	汽车后市场	title	疑问	疑问	刚提新车就换空滤？修车师傅摇头：这3种情况才真该换	\N	\N	f	ai	t	2026-08-09 14:37:22.376	2026-08-09 14:37:22.376
cmslwphs9003ei5hczl0zghae	汽车后市场	title	痛点	痛点	为什么隔壁老王保养完油耗降了0.8L？秘密藏在这张工单里	\N	\N	f	ai	t	2026-08-09 14:37:22.378	2026-08-09 14:37:22.378
cmslwphsb003fi5hcoo9hrtpy	汽车后市场	title	福利	福利	轮胎扎钉别急换！修理工现场演示：补胎+动平衡仅需68元	\N	\N	f	ai	t	2026-08-09 14:37:22.379	2026-08-09 14:37:22.379
cmslwphsc003gi5hcknbly8yf	汽车后市场	title	权威数据	权威数据	原厂件”贴牌卖3倍价？拆开3款机滤对比，第2个根本不是同厂	\N	\N	f	ai	t	2026-08-09 14:37:22.38	2026-08-09 14:37:22.38
cmslwphsd003hi5hcfy525ktv	汽车后市场	title	悬念	悬念	说好只换雨刷，结果偷偷拆了电瓶？监控实拍透明车间全过程	\N	\N	f	ai	t	2026-08-09 14:37:22.382	2026-08-09 14:37:22.382
cmslwphse003ii5hcjlefduz7	汽车后市场	title	共情	共情	上个月被坑换副厂刹车片，这个月我们免费拆检+全额退差价	\N	\N	f	ai	t	2026-08-09 14:37:22.383	2026-08-09 14:37:22.383
cmslwphsg003ji5hcgqeu8rmw	汽车后市场	title	故事	故事	客户把旧件带走验货，我们连包装盒批号都拍给你看	\N	\N	f	ai	t	2026-08-09 14:37:22.385	2026-08-09 14:37:22.385
cmslwphsi003ki5hcr7q1ptgd	汽车后市场	title	清单	清单	你家配件能查溯源吗？”——扫码即见出厂日期+物流全程	\N	\N	f	ai	t	2026-08-09 14:37:22.386	2026-08-09 14:37:22.386
cmslwphsj003li5hcwunwau4g	汽车后市场	title	热点	热点	为什么同一台车，在A店做四轮定位要280，在我们店只要120？	\N	\N	f	ai	t	2026-08-09 14:37:22.388	2026-08-09 14:37:22.388
cmslwphsl003mi5hcwukknw2z	汽车后市场	title	对比	对比	洗车店老板坦白：95%的“精洗套餐”根本没用中性PH值洗剂	\N	\N	f	ai	t	2026-08-09 14:37:22.389	2026-08-09 14:37:22.389
cmslwphso003ni5hc1bs33fej	汽车后市场	title	对比	对比	刚毕业那年被收380元空调清洗，现在我开店只收98还保3个月	\N	\N	f	ai	t	2026-08-09 14:37:22.392	2026-08-09 14:37:22.392
cmslwphsp003oi5hcf0g4m5uw	汽车后市场	title	对比	对比	老婆说我太抠？可她开车空调异味半年，花98搞定还送除菌报告	\N	\N	f	ai	t	2026-08-09 14:37:22.394	2026-08-09 14:37:22.394
cmslwphsr003pi5hc9r3zp46g	汽车后市场	title	对比	对比	新手司机第一次自己换火花塞？师傅手把手教，材料包全配齐	\N	\N	f	ai	t	2026-08-09 14:37:22.395	2026-08-09 14:37:22.395
cmslwphss003qi5hc1r6wa9gc	汽车后市场	title	对比	对比	【本地实测】12家门店空调清洗报价单曝光：最高420，最低78	\N	\N	f	ai	t	2026-08-09 14:37:22.396	2026-08-09 14:37:22.396
cmslwphst003ri5hcax7rcap0	汽车后市场	title	对比	对比	全市217位车主投票：最不想再踩的3个保养坑，第2名超63%	\N	\N	f	ai	t	2026-08-09 14:37:22.398	2026-08-09 14:37:22.398
cmslwphsv003si5hcjicfiuuw	汽车后市场	title	对比	对比	机油滤清器抽检报告出炉：4成低价滤芯过滤效率不足60%	\N	\N	f	ai	t	2026-08-09 14:37:22.399	2026-08-09 14:37:22.399
cmslwphsw003ti5hc0uwgr90l	汽车后市场	title	对比	对比	本季度故障率TOP3车型榜单发布：你的车在第几？附专属养护方案	\N	\N	f	ai	t	2026-08-09 14:37:22.401	2026-08-09 14:37:22.401
cmslwphsy003ui5hcyblkge5t	汽车后市场	title	对比	对比	2024夏季胎压大数据：本地车主平均偏高22kPa，爆胎风险+37%	\N	\N	f	ai	t	2026-08-09 14:37:22.402	2026-08-09 14:37:22.402
cmslwphsz003vi5hcw4gjjwmd	汽车后市场	title	对比	对比	师傅，我这车还能开几年？”——听他讲完，我当场续了储值卡	\N	\N	f	ai	t	2026-08-09 14:37:22.403	2026-08-09 14:37:22.403
cmslwpht1003wi5hc8aefu6q3	汽车后市场	title	对比	对比	凌晨2点拖车进店，修完还送热粥和代驾券，他说这是老规矩	\N	\N	f	ai	t	2026-08-09 14:37:22.405	2026-08-09 14:37:22.405
cmslwpht3003xi5hcmeni259n	汽车后市场	title	对比	对比	上个月暴雨泡水车，我们拆检2天不收工时费，只换受损件	\N	\N	f	ai	t	2026-08-09 14:37:22.407	2026-08-09 14:37:22.407
cmslwpht4003yi5hch8hqm2m5	汽车后市场	title	对比	对比	那个总来擦玻璃不修车的大爷，昨天悄悄给店里送了锦旗	\N	\N	f	ai	t	2026-08-09 14:37:22.409	2026-08-09 14:37:22.409
cmslwpht6003zi5hcsfa350w1	汽车后市场	title	对比	对比	客户带孩子来看“爸爸的车怎么修”，师傅边装边讲齿轮原理	\N	\N	f	ai	t	2026-08-09 14:37:22.41	2026-08-09 14:37:22.41
cmslwpht70040i5hca1d6uawq	汽车后市场	title	对比	对比	方向盘发抖？先别急着做四轮定位！”——3步自检法发给你	\N	\N	f	ai	t	2026-08-09 14:37:22.412	2026-08-09 14:37:22.412
cmslwpht80041i5hc4nzax43j	汽车后市场	title	对比	对比	换一次正时皮带=省下2次大修钱？这份寿命对照表请收好	\N	\N	f	ai	t	2026-08-09 14:37:22.413	2026-08-09 14:37:22.413
cmslwpht90042i5hcv2s40h70	汽车后市场	title	对比	对比	汽车空调不出风？90%是这5个地方堵了，自己动手清3分钟搞定	\N	\N	f	ai	t	2026-08-09 14:37:22.414	2026-08-09 14:37:22.414
cmslwphta0043i5hc07ioq6sp	汽车后市场	title	对比	对比	4S店不会告诉你的7个保养时间点，错过一个伤车又多花2000	\N	\N	f	ai	t	2026-08-09 14:37:22.415	2026-08-09 14:37:22.415
cmslwphtb0044i5hcdz4is2a6	汽车后市场	title	对比	对比	雨刮异响、油耗变高、启动延迟…这12个信号说明该做深度养护了	\N	\N	f	ai	t	2026-08-09 14:37:22.416	2026-08-09 14:37:22.416
cmslwphtd0045i5hcnynxu3px	汽车后市场	title	对比	对比	特斯拉Model Y车主晒单：底盘装甲+电池保温膜，立省电费216元/月	\N	\N	f	ai	t	2026-08-09 14:37:22.417	2026-08-09 14:37:22.417
cmslwphtf0046i5hcrtzqy4zz	汽车后市场	title	对比	对比	比亚迪海豹用户反馈：原厂冷却液vs我们的长效型，高温衰减差41%	\N	\N	f	ai	t	2026-08-09 14:37:22.419	2026-08-09 14:37:22.419
cmslwphth0047i5hc9i4tdhc3	汽车后市场	title	对比	对比	北京暴雨后爆单：3天抢修87台涉水车，我们连夜更新涉水检测SOP	\N	\N	f	ai	t	2026-08-09 14:37:22.421	2026-08-09 14:37:22.421
cmslwphti0048i5hcn1ccdvgx	汽车后市场	title	对比	对比	端午节前爆满！200+车主排队做节前安全检，附错峰预约通道	\N	\N	f	ai	t	2026-08-09 14:37:22.423	2026-08-09 14:37:22.423
cmslwphtk0049i5hciyt3of4d	汽车后市场	title	对比	对比	高考接送专车福利上线：凭准考证享免费全车消毒+轮胎安全检查	\N	\N	f	ai	t	2026-08-09 14:37:22.424	2026-08-09 14:37:22.424
cmslwphtm004ai5hctwhs1iv3	汽车后市场	title	对比	对比	4S店换刹车片收费598，我们同品牌同型号只收328还质保2年	\N	\N	f	ai	t	2026-08-09 14:37:22.426	2026-08-09 14:37:22.426
cmslwphtn004bi5hcjvqflo38	汽车后市场	title	对比	对比	进口壳牌 vs 国产全合成？实测1000km衰减数据，差值不到3%	\N	\N	f	ai	t	2026-08-09 14:37:22.428	2026-08-09 14:37:22.428
cmslwphto004ci5hcjk2628t3	汽车后市场	title	对比	对比	同样做小保养，别人换3个滤芯，我们坚持只换该换的那1个	\N	\N	f	ai	t	2026-08-09 14:37:22.429	2026-08-09 14:37:22.429
cmslwphtq004di5hcf7cjdphq	汽车后市场	title	对比	对比	隔壁店喷漆报价1680，我们免打磨快修+保险直赔，实付890	\N	\N	f	ai	t	2026-08-09 14:37:22.43	2026-08-09 14:37:22.43
cmslwphtr004ei5hc6fdrh6nj	汽车后市场	title	对比	对比	原厂雨刷198一支？我们认证替代款69，实测刮得更干净静音	\N	\N	f	ai	t	2026-08-09 14:37:22.431	2026-08-09 14:37:22.431
cmslwphts004fi5hcx7mmut0r	汽车后市场	title	对比	对比	你敢不敢把旧机油倒进量杯？我们现场测含铁量，超标立刻提醒	\N	\N	f	ai	t	2026-08-09 14:37:22.433	2026-08-09 14:37:22.433
cmslwphtu004gi5hcff8jj4mx	汽车后市场	title	对比	对比	同样的奔驰C260，4S店建议换变速箱油，我们检测后说还能跑2万公里	\N	\N	f	ai	t	2026-08-09 14:37:22.434	2026-08-09 14:37:22.434
cmslwphtw004hi5hctz3788ub	汽车后市场	title	对比	对比	你们能修新能源车？”——拆开比亚迪刀片电池包，只修模块不换整包	\N	\N	f	ai	t	2026-08-09 14:37:22.436	2026-08-09 14:37:22.436
cmslwphtx004ii5hcq6cq5god	汽车后市场	title	对比	对比	别再信“终身免维护”！这张真实拆解图告诉你电瓶到底几年一换	\N	\N	f	ai	t	2026-08-09 14:37:22.438	2026-08-09 14:37:22.438
cmslwphtz004ji5hcoigqwsur	汽车后市场	title	对比	对比	都说国产配件不行？拆开3款国产氧传感器，精度实测误差＜0.8%	\N	\N	f	ai	t	2026-08-09 14:37:22.439	2026-08-09 14:37:22.439
cmslwqgo4004ki5hcg4rsx7hb	汽车后市场	article	新客引流	\N	\N	新客首次到店，免费做全车安全检测（含胎压、刹车油、灯光、底盘目视），不推销不加项！检测报告当场打印+微信同步，有问题标红提醒，没毛病也给你安心。现在预约还送玻璃水1瓶+雨刮精洗1次，扫码填手机号立刻锁名额，本周仅剩23个免费名额→	\N	f	ai	t	2026-08-09 14:38:07.587	2026-08-09 14:38:07.587
cmslwqgo6004li5hcya2lla0f	汽车后市场	article	老客复购	\N	\N	刚提新车的你，别急着去4S店首保！我们用原厂同标机油+曼牌滤芯，工时费直降40%，全程录像可回看，保养后送3个月免费轮胎动平衡。已有87位本地车主验证：同样保养，省268元，服务不打折→	\N	f	ai	t	2026-08-09 14:38:07.59	2026-08-09 14:38:07.59
cmslwqgo7004mi5hcq20myef3	汽车后市场	article	产品种草	\N	\N	抖音刷到我们？恭喜你捡到本地最实在的养车口子！不搞虚的“尊享套餐”，只推透明价目表：小保养198元起（含嘉实多/美孚全合成+马勒滤芯+工时），明码标价贴墙上，扫码查配件溯源码，来就送车载吸尘器体验装→	\N	f	ai	t	2026-08-09 14:38:07.591	2026-08-09 14:38:07.591
cmslwqgo8004ni5hc03gjk9av	汽车后市场	article	客户见证	\N	\N	老客返店，系统自动弹出“爱车健康分”：满85分送精洗1次，95分以上升级全车内饰蒸洗！你的每次保养、胎压监测、雨刮更换都计分，积分还能当钱花。上月张姐凭126分兑了大灯翻新，她说：“比攒奶茶券有用多了”→	\N	f	ai	t	2026-08-09 14:38:07.593	2026-08-09 14:38:07.593
cmslwqgo9004oi5hcgk43ggxy	汽车后市场	article	节假日活动	\N	\N	上次保养说“等忙完再来”的你，我们帮你把下次保养时间算好了：您的卡罗拉已行驶8920km，建议10000km或6个月做小保养，现在预约享免工时费+赠送冷却液冰点检测。微信回复【到期】自动推送专属提醒→	\N	f	ai	t	2026-08-09 14:38:07.594	2026-08-09 14:38:07.594
cmslwqgoa004pi5hcr03la8uf	汽车后市场	article	品牌故事	\N	\N	老客户专属“安心续保包”上线：连续2年在本店保养，第3年享全年保养8折+免费代驾取送车2次+事故快处协助。已有142位车主加入，李师傅的帕萨特连保5年，去年自费项目全免，他说：“早该这么干了”→	\N	f	ai	t	2026-08-09 14:38:07.595	2026-08-09 14:38:07.595
cmslwqgob004qi5hcpybw6vdd	汽车后市场	article	上新公告	\N	\N	夏天空调不凉？别急着换压缩机！90%是冷媒不足或管路微堵，我们用专业检漏仪+压力表诊断，20分钟出结果，修不好不收费。今天下单空调深度杀菌+冷媒补充，立减60元，还送UV-C紫外线消毒卡（车内持续抑菌30天）→	\N	f	ai	t	2026-08-09 14:38:07.596	2026-08-09 14:38:07.596
cmslwqgod004ri5hcqlz766iy	汽车后市场	article	优惠活动	\N	\N	方向盘抖动≠必须换轮胎！可能是动平衡失准、卡钳锈蚀或转向拉杆球头松动。我们用四轮定位仪+制动盘跳动检测仪逐项排查，不换不该换的，不漏真该修的。附赠《抖动自查指南》电子版→	\N	f	ai	t	2026-08-09 14:38:07.597	2026-08-09 14:38:07.597
cmslwqgoe004si5hcurn53ftz	汽车后市场	article	知识科普	\N	\N	雨季刹车异响？先别换片！潮湿环境下刹车盘轻微氧化属正常，我们提供免费刹车系统干燥养护（含盘面抛光+防锈涂层），做完试车无异响再付费。本月已帮63台车省下换片费用→	\N	f	ai	t	2026-08-09 14:38:07.598	2026-08-09 14:38:07.598
cmslwqgof004ti5hcr9tlno0s	汽车后市场	article	互动话题	\N	\N	王姐上周带孩子来保养，顺手拍下技师拆装机油滤芯全过程发朋友圈：“原来真的不用拧断旧滤芯！”——她不知道，我们所有保养都开启工位监控，手机扫码就能看实时画面，修什么、换什么、旧件在哪，一清二楚→	\N	f	ai	t	2026-08-09 14:38:07.6	2026-08-09 14:38:07.6
cmslwqgoh004ui5hcmog1ihks	汽车后市场	article	答疑辟谣	\N	\N	刘哥的CR-V跑了12万公里，坚持在我们这做保养，上个月发动机大修报价比别家低3200元。他晒出发动机拆解对比图：“你们换的正时皮带是盖茨原厂，隔壁店给我装了个没LOGO的”→	\N	f	ai	t	2026-08-09 14:38:07.601	2026-08-09 14:38:07.601
cmslwqgoi004vi5hcinq2fauh	汽车后市场	article	会员权益	\N	\N	没想到洗车师傅还认得出我车的型号年份！”——陈老师说，洗车时小哥主动提醒：“您这代思域尾门胶条老化了，再拖两个月会渗水。”当天免费补胶，还教她怎么自己检查。真实，从细节开始→	\N	f	ai	t	2026-08-09 14:38:07.602	2026-08-09 14:38:07.602
cmslwqgoj004wi5hcb5fuhv9y	汽车后市场	article	会员权益	\N	\N	端午包“粽”有礼：进店即送手作艾草香囊（驱蚊避秽）+全车香薰喷雾（植物萃取无酒精）。保养满398元，抽3位送车载冰箱；消费满698元，加1元换购龙舟造型应急电源（带USB-C快充+强光LED）。活动限6.1-6.10→	\N	f	ai	t	2026-08-09 14:38:07.603	2026-08-09 14:38:07.603
cmslwqgok004xi5hclwsiz8pu	汽车后市场	article	会员权益	\N	\N	中秋团圆养车节：带父母来店，双人免费测血压+血糖（合作社区医院驻点），您保养，爸妈领养生茶礼盒。老客户携新客同行，双方各得100元储值金（可拆分用于轮胎/美容/钣喷）→	\N	f	ai	t	2026-08-09 14:38:07.604	2026-08-09 14:38:07.604
cmslwqgol004yi5hcsgv9dreo	汽车后市场	article	会员权益	\N	\N	国庆焕新计划：9月25日起，旧车膜撕除+高清纳米陶瓷镀膜套餐直降380元，含施工保险（镀膜脱落全额赔）。另设“爱国车牌框”定制区，免费激光刻字，晒单再送国旗车贴一套→	\N	f	ai	t	2026-08-09 14:38:07.605	2026-08-09 14:38:07.605
cmslwqgom004zi5hcrw8pe1ne	汽车后市场	article	会员权益	\N	\N	我们不是开修理厂起家的——2013年，3个汽修老师傅在城西租下80㎡仓库，靠手写保养记录本和一把游标卡尺赢得第一批车主信任。如今11年，3200+家庭选择我们，但墙上那本泛黄的手写台账还在，写着：“2014.3.12 王建军，卡罗拉，首保，嘉实多极护，满意”→	\N	f	ai	t	2026-08-09 14:38:07.607	2026-08-09 14:38:07.607
cmslwqgon0050i5hc5a07puz8	汽车后市场	article	会员权益	\N	\N	老板老周修车28年，从国营厂技工到带徒弟开连锁，没投过一条广告。他说：“口碑不是喊出来的，是车主等红灯时顺手给朋友发的那条语音——‘就在地铁3号线B口对面，修得细，价格写墙上’。”→	\N	f	ai	t	2026-08-09 14:38:07.608	2026-08-09 14:38:07.608
cmslwqgoo0051i5hc5fwnhn9x	汽车后市场	article	会员权益	\N	\N	店里那台2008年的四柱举升机还在用，不是舍不得换，是它托起过5862台车，包括救护车、消防车、高考接送车。新设备买了，但它被我们命名为“守信一号”，旁边挂着车主送的锦旗：“稳如磐石，诚如初心”→	\N	f	ai	t	2026-08-09 14:38:07.609	2026-08-09 14:38:07.609
cmslwqgoq0052i5hcd0pq0yza	汽车后市场	article	会员权益	\N	\N	即日起，全系轮胎升级“安心选”：邓禄普/韩泰/优科豪马三品牌明码标价，含免费动平衡+气门嘴+废弃胎回收。下单即锁定当日最低价，7天内同款降价双倍补差。另推“轮胎身份证”服务：扫码查生产日期、批次、仓储温湿度→	\N	f	ai	t	2026-08-09 14:38:07.61	2026-08-09 14:38:07.61
cmslwqgor0053i5hci2czh3fa	汽车后市场	article	会员权益	\N	\N	新款“隐形车衣PLUS”上市：采用日本进口TPU基材+自修复涂层，抗黄变提升40%，施工全程直播，边角包覆精度达0.3mm。首月预约享3M认证施工师亲操+10年质保（划痕自愈、腐蚀包赔）→	\N	f	ai	t	2026-08-09 14:38:07.611	2026-08-09 14:38:07.611
cmslwqgos0054i5hczd2s3dog	汽车后市场	article	会员权益	\N	\N	车载香薰系统正式接入——不是挂式，是原厂级线束对接，支持APP控温/定时/浓度调节。适配丰田/本田/大众主流车型，安装免破线，拆卸不留痕。首发价598元（含3支精油胶囊）→	\N	f	ai	t	2026-08-09 14:38:07.612	2026-08-09 14:38:07.612
cmslwqgot0055i5hcvojk68dx	汽车后市场	article	会员权益	\N	\N	暑期学生党专享：凭学生证，小保养158元（基础矿物油版），加30元升全合成，再送“开学安心包”（含胎压笔、应急搭电线、挪车电话牌）。毕业3年内车主，首单享终身机油9折→	\N	f	ai	t	2026-08-09 14:38:07.614	2026-08-09 14:38:07.614
cmslwqgou0056i5hc5zft14xy	汽车后市场	article	会员权益	\N	\N	台风季专项优惠：全车密封条养护+天窗轨道深度清洁套餐，原价280元，现168元。含免费涉水车况快检（空气滤芯/火花塞/电脑板潮湿度），隐患早发现，暴雨不趴窝→	\N	f	ai	t	2026-08-09 14:38:07.615	2026-08-09 14:38:07.615
cmslwqgow0057i5hc7buutzyt	汽车后市场	article	会员权益	\N	\N	高温预警关怀价：空调系统深度清洗（含蒸发箱臭氧杀菌+管道内窥镜检查）限时198元，加50元升级纳米银离子长效抑菌层（持效60天）。做完送“清凉三件套”：遮阳帘+冰感坐垫+车载小风扇→	\N	f	ai	t	2026-08-09 14:38:07.616	2026-08-09 14:38:07.616
cmslwqgox0058i5hccxvjsmdc	汽车后市场	article	会员权益	\N	\N	【知识科普】刹车片厚度低于3mm必须更换！别信“还能用半年”。我们用数显卡尺实测演示：新片12mm，磨损至4mm时制动力下降23%，3mm以下易引发热衰减。到店免费测，数据拍照发您→	\N	f	ai	t	2026-08-09 14:38:07.617	2026-08-09 14:38:07.617
cmslwqgoy0059i5hcfig1kq0g	汽车后市场	article	会员权益	\N	\N	【知识科普】汽油标号不是越高越好！92#适合压缩比≤10的自然吸气车，盲目加95#反而积碳。我们帮您查《车辆用户手册》指定标号，并提供燃油清净剂添加建议（按里程周期，非“每次加油都加”）→	\N	f	ai	t	2026-08-09 14:38:07.618	2026-08-09 14:38:07.618
cmslwqgp0005ai5hcoz2uurvq	汽车后市场	article	会员权益	\N	\N	【知识科普】自动启停伤发动机？真相是：合格电瓶+原厂启停程序下，启动磨损≈0.03秒怠速损耗。我们用示波器实测启动电流曲线，对比传统启动，曲轴负荷降低67%。欢迎带疑问来“实验室”看数据→	\N	f	ai	t	2026-08-09 14:38:07.62	2026-08-09 14:38:07.62
cmslwqgp1005bi5hcs2b2sqww	汽车后市场	article	会员权益	\N	\N	【互动话题】你车上的哪个小设计，越用越觉得厂家太懂生活？（比如：雷克萨斯扶手箱里的纸巾槽、飞度后排座椅放倒的隐藏挂钩、宋PLUS的后备箱12V接口…）评论区晒图，抽10人送“车载收纳进化套装”→	\N	f	ai	t	2026-08-09 14:38:07.621	2026-08-09 14:38:07.621
cmslwqgp2005ci5hc76nqjccr	汽车后市场	article	会员权益	\N	\N	【互动话题】如果给你的爱车起个外号，它会叫什么？为什么？（例：我家轩逸叫“老黄牛”，三年零故障；小鹏P7叫“夜行侠”，冬天续航从不虚标…）留言最走心的3位，送全年免费玻璃水→	\N	f	ai	t	2026-08-09 14:38:07.622	2026-08-09 14:38:07.622
cmslwqgp2005di5hcu49a9555	汽车后市场	article	会员权益	\N	\N	【互动话题】你经历过最“离谱”的4S店话术是什么？（比如：“这个螺丝出厂就带胶，拧下来就报废”“系统显示要换，不换影响质保”…）我们整理成《避坑话术红黑榜》，评论区揪人送纸质版+解读课→	\N	f	ai	t	2026-08-09 14:38:07.623	2026-08-09 14:38:07.623
cmslwqgp3005ei5hcx8puwr04	汽车后市场	article	会员权益	\N	\N	【答疑辟谣】“变速箱油终生免维护”？错！AT变速箱每8万公里、CVT每6万公里必须更换，否则油泥堵塞阀体，维修费超8000元。我们提供油品光谱分析服务，直观看到金属颗粒含量→	\N	f	ai	t	2026-08-09 14:38:07.624	2026-08-09 14:38:07.624
cmslwqgp4005fi5hcx9719t3i	汽车后市场	article	会员权益	\N	\N	【答疑辟谣】“打蜡越勤越好”？大错！普通蜡每月1次封顶，频繁操作反而加速清漆层氧化。我们推荐：季度镀晶（SiO2）替代打蜡，一次防护90天，不伤漆面，雨滴自动滑落→	\N	f	ai	t	2026-08-09 14:38:07.624	2026-08-09 14:38:07.624
cmslwqgp4005gi5hctin69i9d	汽车后市场	article	会员权益	\N	\N	【答疑辟谣】“新能源车不用保养”？荒谬！电池温控液2年/4万公里需更换，空调滤芯含PM2.5传感器需定期校准，驱动电机轴承脂也有寿命。我们专设新能源体检清单，12项免费初检→	\N	f	ai	t	2026-08-09 14:38:07.625	2026-08-09 14:38:07.625
cmslwqgp5005hi5hc2yu1lvgp	汽车后市场	article	会员权益	\N	\N	会员充值3000元，立得500元无门槛券+全年免费洗车（不限次数）+生日月双倍积分。更关键的是：所有会员价公开上墙，小保养178元起，比非会员低20元，且配件扫码查授权书→	\N	f	ai	t	2026-08-09 14:38:07.626	2026-08-09 14:38:07.626
cmslwqgp6005ii5hcz4a3svja	汽车后市场	article	会员权益	\N	\N	加入“安心养车俱乐部”，享三大特权：① 故障远程初诊（视频连线技师）② 免费代驾取送车（单程15km内）	\N	f	ai	t	2026-08-09 14:38:07.626	2026-08-09 14:38:07.626
cmslwrlq2007di5hckf4ni6ty	房产中介	title	对比	对比	高架旁噪音超标？我们用分贝仪实测+夜间录音，数据全公开	\N	\N	f	ai	t	2026-08-09 14:39:00.795	2026-08-09 14:39:00.795
cmslwqs23005ji5hcdrnd6qr9	汽车后市场	topic	\N	\N	春困犯懒？你的空调滤芯正在偷偷“毒害”全家呼吸｜春季必换项目实测对比	\N	\N	f	ai	t	2026-08-09 14:38:22.348	2026-08-09 14:38:22.348
cmslwqs26005ki5hcyg2elp9x	汽车后市场	topic	\N	\N	五一自驾前必做5项检查！3个被90%车主忽略的隐患（附免费检测清单）	\N	\N	f	ai	t	2026-08-09 14:38:22.35	2026-08-09 14:38:22.35
cmslwqs28005li5hcz5b2tr8d	汽车后市场	topic	\N	\N	夏天快到了，别等开锅才想起冷却液！不同颜色/年限的冷却液能混加吗？	\N	\N	f	ai	t	2026-08-09 14:38:22.352	2026-08-09 14:38:22.352
cmslwqs29005mi5hcdwxe9vdy	汽车后市场	topic	\N	\N	618不买家电买保养！我们把全店工时费打到骨折价，配件明码标价拍视频	\N	\N	f	ai	t	2026-08-09 14:38:22.353	2026-08-09 14:38:22.353
cmslwqs2a005ni5hc7my41jfq	汽车后市场	topic	\N	\N	暴雨季来临！雨刮器真能撑过整个梅雨？教你3秒识别老化胶条（附更换教程）	\N	\N	f	ai	t	2026-08-09 14:38:22.355	2026-08-09 14:38:22.355
cmslwqs2b005oi5hcx95a9fgs	汽车后市场	topic	\N	\N	高考接送车怎么保养？静音+空调+刹车三重保障方案，学生家长专享85折	\N	\N	f	ai	t	2026-08-09 14:38:22.355	2026-08-09 14:38:22.355
cmslwqs2c005pi5hclccprz7f	汽车后市场	topic	\N	\N	高温暴晒后胎压自动升高？不是错觉！真实数据告诉你该不该放气	\N	\N	f	ai	t	2026-08-09 14:38:22.356	2026-08-09 14:38:22.356
cmslwqs2d005qi5hc8134saka	汽车后市场	topic	\N	\N	暑假亲子游前夜，带娃车主最怕什么？我们连夜做完20台车底盘快检并直播	\N	\N	f	ai	t	2026-08-09 14:38:22.357	2026-08-09 14:38:22.357
cmslwqs2e005ri5hcirt4fb2k	汽车后市场	topic	\N	\N	台风天修车难？我们提前囤好原厂雨刮+密封条，故障当天上门取送车	\N	\N	f	ai	t	2026-08-09 14:38:22.358	2026-08-09 14:38:22.358
cmslwqs2e005si5hc8kwssftp	汽车后市场	topic	\N	\N	七夕不送花送安心！情侣共驾车辆专项检测：刹车片+离合+空调深度养护	\N	\N	f	ai	t	2026-08-09 14:38:22.359	2026-08-09 14:38:22.359
cmslwqs2f005ti5hclxrlpqq1	汽车后市场	topic	\N	\N	开学季家长车高频痛点：后备箱儿童安全座椅安装位锈蚀？我们免费除锈加固	\N	\N	f	ai	t	2026-08-09 14:38:22.36	2026-08-09 14:38:22.36
cmslwqs2g005ui5hcfcezmbnr	汽车后市场	topic	\N	\N	中秋团圆车况不能拖！节前72小时快保通道开启，含免费四轮动平衡	\N	\N	f	ai	t	2026-08-09 14:38:22.36	2026-08-09 14:38:22.36
cmslwqs2h005vi5hc6on5jpi9	汽车后市场	topic	\N	\N	国庆长假倒计时！高速前必查的4个油液+2个灯组，漏1项可能被拖车	\N	\N	f	ai	t	2026-08-09 14:38:22.361	2026-08-09 14:38:22.361
cmslwqs2i005wi5hc6oshlktr	汽车后市场	topic	\N	\N	双11不是剁手是“养车”！储值3000送全年洗车+季度免费胎压监测	\N	\N	f	ai	t	2026-08-09 14:38:22.362	2026-08-09 14:38:22.362
cmslwqs2i005xi5hcsd3shbw0	汽车后市场	topic	\N	\N	立冬第一波冷空气来了！防冻液冰点实测 vs 你家爱车实际需求匹配表	\N	\N	f	ai	t	2026-08-09 14:38:22.363	2026-08-09 14:38:22.363
cmslwqs2j005yi5hcl8vp6627	汽车后市场	topic	\N	\N	冬季玻璃水结冰？99%人加错型号！-25℃/-40℃怎么选？现场冻融实验对比	\N	\N	f	ai	t	2026-08-09 14:38:22.364	2026-08-09 14:38:22.364
cmslwqs2k005zi5hc94t123z0	汽车后市场	topic	\N	\N	元旦跨年自驾预警：电瓶寿命只剩30%？我们用专业设备测出真实健康度	\N	\N	f	ai	t	2026-08-09 14:38:22.364	2026-08-09 14:38:22.364
cmslwqs2l0060i5hchq1m9ftg	汽车后市场	topic	\N	\N	春节返乡潮启动！长途前免费做“回家五件套”：轮胎/刹车/灯光/油液/空调	\N	\N	f	ai	t	2026-08-09 14:38:22.365	2026-08-09 14:38:22.365
cmslwqs2l0061i5hc9999swoq	汽车后市场	topic	\N	\N	年夜饭聚餐多，车内异味藏细菌！臭氧+纳米雾化双消杀，过程全程录像	\N	\N	f	ai	t	2026-08-09 14:38:22.366	2026-08-09 14:38:22.366
cmslwqs2m0062i5hcxqmbbd70	汽车后市场	topic	\N	\N	正月十五元宵节，猜灯谜赢保养！门店挂灯笼，答对3题立减200元工时费	\N	\N	f	ai	t	2026-08-09 14:38:22.367	2026-08-09 14:38:22.367
cmslwqs2n0063i5hcem46t447	汽车后市场	topic	\N	\N	3·15来了，我们把所有机油滤芯拆开拍显微镜图：真假滤纸孔径对比实录	\N	\N	f	ai	t	2026-08-09 14:38:22.368	2026-08-09 14:38:22.368
cmslwqs2o0064i5hc0kjkfopb	汽车后市场	topic	\N	\N	春暖花开自驾热！我们把全城12条热门路线做成「路况-保养适配指南」	\N	\N	f	ai	t	2026-08-09 14:38:22.369	2026-08-09 14:38:22.369
cmslwqs2p0065i5hcj7jrsjyr	汽车后市场	topic	\N	\N	清明祭扫山路多，刹车系统专项检测限时半价（含制动盘厚度测量报告）	\N	\N	f	ai	t	2026-08-09 14:38:22.37	2026-08-09 14:38:22.37
cmslwqs2q0066i5hcjnq1fwzl	汽车后市场	topic	\N	\N	谷雨湿气重，空调霉味反复？深度清洗+抗菌涂层实测前后菌落培养对比	\N	\N	f	ai	t	2026-08-09 14:38:22.371	2026-08-09 14:38:22.371
cmslwqs2r0067i5hc0g6fcpll	汽车后市场	topic	\N	\N	五一调休变相加班？车主专属“午间快保档”：60分钟完成基础保养不排队	\N	\N	f	ai	t	2026-08-09 14:38:22.372	2026-08-09 14:38:22.372
cmslwqs2s0068i5hcyc8n2hom	汽车后市场	topic	\N	\N	6月高考房紧张？我们联合周边酒店推「考生家庭车托管服务」含免费充电+洗车	\N	\N	f	ai	t	2026-08-09 14:38:22.373	2026-08-09 14:38:22.373
cmslwqs2u0069i5hcza8kwscn	汽车后市场	topic	\N	\N	夏至高温预警！轮胎侧面鼓包肉眼难辨？红外热成像仪现场扫描演示	\N	\N	f	ai	t	2026-08-09 14:38:22.374	2026-08-09 14:38:22.374
cmslwqs2v006ai5hcj5b8yfmv	汽车后市场	topic	\N	\N	暑期学车族增多！新手司机首保避坑指南：4S店说要换的，我们真没换	\N	\N	f	ai	t	2026-08-09 14:38:22.376	2026-08-09 14:38:22.376
cmslwqs2w006bi5hc34ckydp5	汽车后市场	topic	\N	\N	教师节感恩回馈：凭教师资格证享全车电路检测+免费蓄电池负荷测试	\N	\N	f	ai	t	2026-08-09 14:38:22.376	2026-08-09 14:38:22.376
cmslwqs2x006ci5hc5hz4ikxj	汽车后市场	topic	\N	\N	冬至进补不如给车“进补”！变速箱油换不换？我们用旧油颜色+粘度仪说话	\N	\N	f	ai	t	2026-08-09 14:38:22.377	2026-08-09 14:38:22.377
cmslwr5pk006di5hcr3hwzct2	汽车后市场	image_prompt	\N	\N	\N	一张高清ins风配图：透明玻璃橱窗内整齐陈列原厂机油滤清器、空气滤芯、雨刷片，背景为浅灰水泥墙与绿植，顶部悬挂金属质感价签“¥98起”，自然光照射下配件反光细腻，画面干净有呼吸感	\N	f	ai	t	2026-08-09 14:38:40.04	2026-08-09 14:38:40.04
cmslwr5pm006ei5hc1lcl4r44	汽车后市场	image_prompt	\N	\N	\N	一张写实风格配图：汽修车间内技师正用电子扭矩扳手紧固发动机舱螺栓，工装整洁，工具台摆放正品博世火花塞与旧件对比，背景可见清晰工单二维码和“每车一档·全程录像”标牌	\N	f	ai	t	2026-08-09 14:38:40.043	2026-08-09 14:38:40.043
cmslwr5po006fi5hcshgnbiep	汽车后市场	image_prompt	\N	\N	\N	一张国潮风配图：红金配色主视觉，水墨晕染的“龙纹”环绕长安CS75PLUS引擎盖，盖上立体烫金文字“真配件·真保障”，底部祥云纹样托起“厂家直供｜假一赔三”标语，整体喜庆又专业	\N	f	ai	t	2026-08-09 14:38:40.045	2026-08-09 14:38:40.045
cmslwr5pp006gi5hcgcc04hht	汽车后市场	image_prompt	\N	\N	\N	一张ins风门店环境配图：阳光透过落地窗洒在浅木纹接待区，绿植墙旁放置皮质沙发与iPad预约终端，前台玻璃立牌写着“免费洗车｜15分钟快保”，暖色调光影营造温馨信任感	\N	f	ai	t	2026-08-09 14:38:40.046	2026-08-09 14:38:40.046
cmslwr5pr006hi5hcnqfegfei	汽车后市场	image_prompt	\N	\N	\N	一张写实门店环境配图：双工位快修车间实景，两名技师同步作业——左侧更换刹车片（镜头聚焦卡钳与正品菲罗多刹车片包装盒），右侧客户通过透明玻璃窗观看，墙上挂满ISO认证证书与技师持证上岗照	\N	f	ai	t	2026-08-09 14:38:40.047	2026-08-09 14:38:40.047
cmslwtm0k00b0i5hc2o582t3v	婚庆摄影	title	对比	对比	这对异地恋新人，靠我们远程选片系统3天敲定全部成片	\N	\N	f	ai	t	2026-08-09 14:40:34.484	2026-08-09 14:40:34.484
cmslwr5ps006ii5hc4q53rigu	汽车后市场	image_prompt	\N	\N	\N	一张国潮风门店环境配图：青砖黛瓦元素融合现代门头，“匠心养车”书法大字居中，两侧灯笼造型灯箱分别标注“保养套餐￥298起”“会员储值送全年洗车”，门口停着贴有“本店车主”车贴的比亚迪海豹	\N	f	ai	t	2026-08-09 14:38:40.049	2026-08-09 14:38:40.049
cmslwr5pt006ji5hcpspjp3cn	汽车后市场	image_prompt	\N	\N	\N	一张ins风活动海报配图：莫兰迪色系背景，手绘风格汽车轮廓内嵌日历图标与礼盒插画，中央突出“618焕新季｜保养+镀晶=立省320”，右下角小字“前20名赠胎压监测仪”，整体轻盈有节日感	\N	f	ai	t	2026-08-09 14:38:40.05	2026-08-09 14:38:40.05
cmslwr5pu006ki5hcshjjrlkn	汽车后市场	image_prompt	\N	\N	\N	一张写实活动海报配图：真实门店门前搭设红色拱门与易拉宝，人群有序排队领取“夏季空调深度清洗券”，工作人员手持平板登记信息，背景横幅印有“明码标价·拒绝加项”，镜头捕捉顾客扫码核销动作	\N	f	ai	t	2026-08-09 14:38:40.05	2026-08-09 14:38:40.05
cmslwr5pv006li5hcpoj17vc5	汽车后市场	image_prompt	\N	\N	\N	一张国潮风活动海报配图：剪纸艺术风格汽车剪影，车内嵌“清凉一夏”篆体字，四周环绕艾草、薄荷叶、冰镇饮料等夏日符号，底部印章式标注“储值500送价值198养护礼包｜限7月	\N	f	ai	t	2026-08-09 14:38:40.051	2026-08-09 14:38:40.051
cmslwr5pw006mi5hcia5q5t7t	汽车后市场	image_prompt	\N	\N	\N	一张ins风客户案例配图：车主侧脸微笑特写，手捧刚做完保养的爱车钥匙与纸质工单（关键信息打码），背景虚化出整洁洗车区与“已服务12,847台次”数据墙，柔焦+胶片颗粒质感	\N	f	ai	t	2026-08-09 14:38:40.052	2026-08-09 14:38:40.052
cmslwr5px006ni5hcq9bvwtsg	汽车后市场	image_prompt	\N	\N	\N	一张写实客户案例配图：真实车主夫妻站在自家丰田卡罗拉旁，技师递上手写感谢卡与旧件包（含更换的机滤/空滤），车窗贴有带二维码的“安心车主证”，画面右下角叠加微信对话截图：“师傅没多收一分，还教我怎么看油尺！	\N	f	ai	t	2026-08-09 14:38:40.053	2026-08-09 14:38:40.053
cmslwr5py006oi5hcn0u70p4u	汽车后市场	image_prompt	\N	\N	\N	一张国潮风客户案例配图：Q版漫画风格三格叙事——第一格车主皱眉看报价单，第二格技师指着配件防伪码讲解，第三格全家在车旁比耶，背景祥云托起“口碑之选·街坊都认”金色标语	\N	f	ai	t	2026-08-09 14:38:40.054	2026-08-09 14:38:40.054
cmslwr5pz006pi5hcvtgt5b87	汽车后市场	image_prompt	\N	\N	\N	一张ins风氛围配图：黄昏时分门店外景，暖光路灯亮起，玻璃门倒映车流与“今日已服务43台”电子屏，门口自动洗车机缓缓运转，一只橘猫蹲坐于LOGO地贴旁，生活感与专业感并存	\N	f	ai	t	2026-08-09 14:38:40.055	2026-08-09 14:38:40.055
cmslwr5q0006qi5hcns3z5qnh	汽车后市场	image_prompt	\N	\N	\N	一张写实氛围配图：冬日清晨，技师冒雪为一辆大众途观L做底盘检查，防护垫铺地、红外测温枪显示油温正常，旁边保温桶盛着热姜茶，远处客户在休息区翻阅《用车避坑指南》手册	\N	f	ai	t	2026-08-09 14:38:40.056	2026-08-09 14:38:40.056
cmslwr5q1006ri5hc0ku6n24p	汽车后市场	image_prompt	\N	\N	\N	一张国潮风氛围配图：春节主题场景，门店悬挂中国结与福字，技师给客户车辆贴“出入平安”车窗贴，后备箱整齐码放定制年货礼盒（印有门店LOGO与“2025全年免费检测”字样），红灯笼光影温暖饱满	\N	f	ai	t	2026-08-09 14:38:40.057	2026-08-09 14:38:40.057
cmslwrlpi006si5hcvw3i0lon	房产中介	title	数字	数字	3套真实在售二手房，业主直签无中介差价，实拍视频已上传	\N	\N	f	ai	t	2026-08-09 14:39:00.773	2026-08-09 14:39:00.773
cmslwrlpk006ti5hcvt790iq9	房产中介	title	反差	反差	5个被90%买家忽略的过户风险点，第4个差点让我赔了20万	\N	\N	f	ai	t	2026-08-09 14:39:00.776	2026-08-09 14:39:00.776
cmslwrlpl006ui5hcffeksmcd	房产中介	title	疑问	疑问	为什么同样地段，他买房省了17万税费？真相藏在购房时间里	\N	\N	f	ai	t	2026-08-09 14:39:00.778	2026-08-09 14:39:00.778
cmslwrlpn006vi5hc804pfkfq	房产中介	title	痛点	痛点	卖房挂3个月没动静？这7个细节正在劝退所有买家	\N	\N	f	ai	t	2026-08-09 14:39:00.779	2026-08-09 14:39:00.779
cmslwrlpo006wi5hc287qa1kw	房产中介	title	福利	福利	新房交付前必查的6项隐蔽工程，开发商不会主动告诉你	\N	\N	f	ai	t	2026-08-09 14:39:00.781	2026-08-09 14:39:00.781
cmslwrlpp006xi5hc0qkxuypo	房产中介	title	权威数据	权威数据	同一小区，挂牌价相差42万！我们拆解了3套同户型成交逻辑	\N	\N	f	ai	t	2026-08-09 14:39:00.782	2026-08-09 14:39:00.782
cmslwrlpq006yi5hcyzarydpu	房产中介	title	悬念	悬念	挂牌28天即成交！这套学区房靠什么打破市场冷周期？	\N	\N	f	ai	t	2026-08-09 14:39:00.783	2026-08-09 14:39:00.783
cmslwrlpr006zi5hctqsmnwdk	房产中介	title	共情	共情	“中介说满五唯一，结果缴了3.8万个税”——客户复盘全过程	\N	\N	f	ai	t	2026-08-09 14:39:00.784	2026-08-09 14:39:00.784
cmslwrlps0070i5hcjonlk7lv	房产中介	title	故事	故事	上周带看12组客户，只成交1单：不是房子不好，是流程卡在第3步	\N	\N	f	ai	t	2026-08-09 14:39:00.784	2026-08-09 14:39:00.784
cmslwrlpt0071i5hcder10qiz	房产中介	title	清单	清单	2024年Q2本地二手房成交均价下跌2.3%，但这个板块逆势涨5.1%	\N	\N	f	ai	t	2026-08-09 14:39:00.785	2026-08-09 14:39:00.785
cmslwrlpt0072i5hct3oyyn8d	房产中介	title	热点	热点	还在等“捡漏”？真正笋盘从不公开挂网，今晚私发3套内部源	\N	\N	f	ai	t	2026-08-09 14:39:00.786	2026-08-09 14:39:00.786
cmslwrlpu0073i5hcgowl6q5y	房产中介	title	对比	对比	“我卖房时多收了3万定金，却丢了整单”｜一位经纪人的真实复盘	\N	\N	f	ai	t	2026-08-09 14:39:00.786	2026-08-09 14:39:00.786
cmslwrlpu0074i5hca2odup9b	房产中介	title	对比	对比	87㎡老破小 vs 72㎡次新两居：总价差8万，月供反少1200元？	\N	\N	f	ai	t	2026-08-09 14:39:00.787	2026-08-09 14:39:00.787
cmslwrlpv0075i5hc3x4emhda	房产中介	title	对比	对比	3年前买这里被骂“接盘”，如今租售比达1:210，业主悄悄补仓2套	\N	\N	f	ai	t	2026-08-09 14:39:00.787	2026-08-09 14:39:00.787
cmslwrlpw0076i5hcz6u4p3y5	房产中介	title	对比	对比	为什么链家/贝壳没推的这套房，我们坚持带看了11次才成交？	\N	\N	f	ai	t	2026-08-09 14:39:00.788	2026-08-09 14:39:00.788
cmslwrlpw0077i5hc3lo01tzw	房产中介	title	对比	对比	客户说“再看看别家”，转身就签约？我们用一份《透明成本清单》赢了	\N	\N	f	ai	t	2026-08-09 14:39:00.789	2026-08-09 14:39:00.789
cmslwrlpy0078i5hcpqc286kt	房产中介	title	对比	对比	2024年房贷利率跌破3.7%，但92%购房者算错了月供浮动区间	\N	\N	f	ai	t	2026-08-09 14:39:00.791	2026-08-09 14:39:00.791
cmslwrlpz0079i5hcf5jol48e	房产中介	title	对比	对比	业主急售！房东父亲住院急需用钱，实拍房产证+病历（已脱敏）	\N	\N	f	ai	t	2026-08-09 14:39:00.791	2026-08-09 14:39:00.791
cmslwrlq0007ai5hc85hhp38g	房产中介	title	对比	对比	“中介说能贷七成，面签被拒”｜我们整理了银行最新5条隐形拒贷红线	\N	\N	f	ai	t	2026-08-09 14:39:00.792	2026-08-09 14:39:00.792
cmslwrlq1007bi5hc82iqbu4z	房产中介	title	对比	对比	真房源承诺书+VR全景+物业费截图，这套房我们敢签三方背书	\N	\N	f	ai	t	2026-08-09 14:39:00.793	2026-08-09 14:39:00.793
cmslwrlq2007ci5hc4ajaylcg	房产中介	title	对比	对比	本地教育局刚公布：2025年起学区微调，这3个楼盘正处政策红利窗口期	\N	\N	f	ai	t	2026-08-09 14:39:00.794	2026-08-09 14:39:00.794
cmslwrlq3007ei5hcvjymalhk	房产中介	title	对比	对比	他卖房没找中介，自己办过户，结果卡在“土地性质核验”整整47天	\N	\N	f	ai	t	2026-08-09 14:39:00.795	2026-08-09 14:39:00.795
cmslwrlq4007fi5hc30xb8zcp	房产中介	title	对比	对比	为什么这套房挂牌198万，最终成交182万？买卖双方都签了价格确认函	\N	\N	f	ai	t	2026-08-09 14:39:00.796	2026-08-09 14:39:00.796
cmslwrlq4007gi5hcgz5y4m4b	房产中介	title	对比	对比	3个房东不愿说的出租真相：租客毁约率、空置周期、维修频次实录	\N	\N	f	ai	t	2026-08-09 14:39:00.797	2026-08-09 14:39:00.797
cmslwrlq5007hi5hcdlapwino	房产中介	title	对比	对比	刚成交！总价295万买下地铁口精装三房，首付仅需42万（附贷款方案）	\N	\N	f	ai	t	2026-08-09 14:39:00.797	2026-08-09 14:39:00.797
cmslwrlq5007ii5hcrsvy456g	房产中介	title	对比	对比	住建局备案价 vs 实际成交价：我们对比了137套新房，差额最高达11.6%	\N	\N	f	ai	t	2026-08-09 14:39:00.798	2026-08-09 14:39:00.798
cmslwrlq6007ji5hcgv82mzx4	房产中介	title	对比	对比	“中介带看绕开关键缺陷”？我们带看全程录像，重点区域逐帧讲解	\N	\N	f	ai	t	2026-08-09 14:39:00.799	2026-08-09 14:39:00.799
cmslwrlq7007ki5hc3723fhsn	房产中介	title	对比	对比	她在中介门店哭着说“不想卖了”，只因发现原报价比市场价高15万	\N	\N	f	ai	t	2026-08-09 14:39:00.8	2026-08-09 14:39:00.8
cmslwrlq8007li5hc7inm7i6r	房产中介	title	对比	对比	2024年本地租房投诉TOP3：押金不退、水电乱加、合同暗藏解约陷阱	\N	\N	f	ai	t	2026-08-09 14:39:00.801	2026-08-09 14:39:00.801
cmslwrlq9007mi5hc2mc9sovh	房产中介	title	对比	对比	同样预算200万，买主城区老房or近郊新房？我们做了5年持有成本对比	\N	\N	f	ai	t	2026-08-09 14:39:00.802	2026-08-09 14:39:00.802
cmslwrlqa007ni5hcckoqqf3m	房产中介	title	对比	对比	业主直降12万！但要求“全款+3天内过户”，我们连夜协调资金监管	\N	\N	f	ai	t	2026-08-09 14:39:00.803	2026-08-09 14:39:00.803
cmslwrlqb007oi5hcdw6bz7w7	房产中介	title	对比	对比	小区业委会刚成立，物业费将上调1.8元/㎡，现在入手可锁定现标准	\N	\N	f	ai	t	2026-08-09 14:39:00.804	2026-08-09 14:39:00.804
cmslwrlqc007pi5hc712g7r4n	房产中介	title	对比	对比	贷款预审不过？我们合作银行提供“预批保底函”，不批全额退服务费	\N	\N	f	ai	t	2026-08-09 14:39:00.804	2026-08-09 14:39:00.804
cmslwrlqc007qi5hckryn1l5h	房产中介	title	对比	对比	为什么这套“凶宅”挂牌半年无人问津，我们带看3次后溢价8%成交？	\N	\N	f	ai	t	2026-08-09 14:39:00.805	2026-08-09 14:39:00.805
cmslwrlqe007ri5hcl160pk6u	房产中介	title	对比	对比	真实成交记录公示：上周本片区12套二手房，最低成交价/最高议价空间	\N	\N	f	ai	t	2026-08-09 14:39:00.807	2026-08-09 14:39:00.807
cmslwrlqf007si5hca0k58jvi	房产中介	title	对比	对比	“中介说满两年免征增值税”，结果满25个月仍缴了2.1万｜政策详解	\N	\N	f	ai	t	2026-08-09 14:39:00.807	2026-08-09 14:39:00.807
cmslwrlqg007ti5hcmy8y1kyd	房产中介	title	对比	对比	他看完3套房就签约：只因我们提前准备了《家庭购房适配度打分表》	\N	\N	f	ai	t	2026-08-09 14:39:00.808	2026-08-09 14:39:00.808
cmslwrlqg007ui5hcs05q2zi3	房产中介	title	对比	对比	2024年二手房交易纠纷中，73%源于“口头承诺未写入合同”	\N	\N	f	ai	t	2026-08-09 14:39:00.809	2026-08-09 14:39:00.809
cmslwrlqh007vi5hc73b9rz6v	房产中介	title	对比	对比	这套法拍房起拍价156万，我们协助竞拍+清场+过户，总成本172万	\N	\N	f	ai	t	2026-08-09 14:39:00.81	2026-08-09 14:39:00.81
cmslwrlqi007wi5hcyjobu6yb	房产中介	title	对比	对比	租房住3年vs直接买房：按当前租金与月供测算，第27个月开始回本	\N	\N	f	ai	t	2026-08-09 14:39:00.811	2026-08-09 14:39:00.811
cmslwrlqj007xi5hc43s8ks1m	房产中介	title	对比	对比	业主出国急售！委托公证+远程签约+资金监管，全程线上完成	\N	\N	f	ai	t	2026-08-09 14:39:00.811	2026-08-09 14:39:00.811
cmslwrlqj007yi5hceazsqxm7	房产中介	title	对比	对比	地铁15号线规划公示，站点500米内这4个楼盘已启动业主意向登记	\N	\N	f	ai	t	2026-08-09 14:39:00.812	2026-08-09 14:39:00.812
cmslwshfx007zi5hcuce1qnmb	房产中介	article	新客引流	\N	\N	【新客引流】	\N	f	ai	t	2026-08-09 14:39:41.9	2026-08-09 14:39:41.9
cmslwshfz0080i5hcskqdffc6	房产中介	article	老客复购	\N	\N	刚来杭州工作？别急着签租房合同！我们实勘278套地铁1公里内真房源，0中介费首单，附赠《杭州租房避坑手册》电子版。所有照片为今日实拍，视频可约远程看房，拒绝“照骗”。加微信发定位，5分钟为您匹配3套符合预算/通勤/安全需求的房源。	\N	f	ai	t	2026-08-09 14:39:41.903	2026-08-09 14:39:41.903
cmslwshg00081i5hcagghjpip	房产中介	article	产品种草	\N	\N	【新客引流】	\N	f	ai	t	2026-08-09 14:39:41.905	2026-08-09 14:39:41.905
cmslwshg10082i5hcvoybs1zn	房产中介	article	客户见证	\N	\N	买房怕踩坑？我们提供「首访安心服务」：免费预约资深顾问1v1面谈（含购房资质预审+贷款试算），到店即送《杭州主城区学区房对照表2024版》。无推销、不套路，只解决您最关心的3个问题——扫码留电话，今天安排专属顾问回电。	\N	f	ai	t	2026-08-09 14:39:41.906	2026-08-09 14:39:41.906
cmslwshg30083i5hco4k1bvoy	房产中介	article	节假日活动	\N	\N	【新客引流】	\N	f	ai	t	2026-08-09 14:39:41.907	2026-08-09 14:39:41.907
cmslwshg40084i5hc672ygv1n	房产中介	article	品牌故事	\N	\N	刷到这条，说明您正在找房！我们不做“广撒网式”推荐，而是用真实成交数据帮您决策：近3个月西湖区90㎡两房平均成交价528万，挂牌超60天房源降价率12.3%。私信“区域+预算”，立刻获取该板块最新笋盘清单（含实拍图+税费明细）。	\N	f	ai	t	2026-08-09 14:39:41.908	2026-08-09 14:39:41.908
cmslwshg50085i5hcqprlubyn	房产中介	article	上新公告	\N	\N	【老客复购】	\N	f	ai	t	2026-08-09 14:39:41.91	2026-08-09 14:39:41.91
cmslwshg60086i5hcfsxc9r0m	房产中介	article	优惠活动	\N	\N	王女士2021年通过我们购入滨江某楼盘，今年置换改善房，全程0新增服务费——老客户复购享“优先带看+免费产权核验+过户加急通道”。她反馈：“上次卖旧买新只用了22天，这次连装修托管都帮对接好了。”您也有置换需求？专属顾问已待命。	\N	f	ai	t	2026-08-09 14:39:41.911	2026-08-09 14:39:41.911
cmslwshg70087i5hcjirgvlkv	房产中介	article	知识科普	\N	\N	【老客复购】	\N	f	ai	t	2026-08-09 14:39:41.912	2026-08-09 14:39:41.912
cmslwshg80088i5hc4b279633	房产中介	article	互动话题	\N	\N	恭喜李哥顺利入住钱江新城新家！他上一套房由我们协助卖出（溢价8%），本次购房又享老客专享：①贷款方案优化（省息3.2万元）②物业交割代办（0跑腿）③赠送2年房屋保值评估服务。老客户转介绍成功，双方各得500元京东卡。	\N	f	ai	t	2026-08-09 14:39:41.913	2026-08-09 14:39:41.913
cmslwshg90089i5hcv9h4lgkl	房产中介	article	答疑辟谣	\N	\N	【老客复购】	\N	f	ai	t	2026-08-09 14:39:41.914	2026-08-09 14:39:41.914
cmslwshga008ai5hcrru61xki	房产中介	article	会员权益	\N	\N	张阿姨把余杭老宅委托我们代售，32天快速成交，比市场快11天。她说：“你们连水电过户提醒都列成清单发我。”现在她女儿在拱墅看房，我们主动调取家庭购房记录，直接匹配改善型四房——老客复购，系统自动触发服务升级。	\N	f	ai	t	2026-08-09 14:39:41.915	2026-08-09 14:39:41.915
cmslwshgb008bi5hcr0b4icub	房产中介	article	会员权益	\N	\N	【产品种草】	\N	f	ai	t	2026-08-09 14:39:41.916	2026-08-09 14:39:41.916
cmslwshgc008ci5hcjtee1th3	房产中介	article	会员权益	\N	\N	实拍｜城西科创大走廊·未来科技城核心区，全新精装次新房：112㎡三房两卫，落地窗直面西溪湿地，单价4.3万/㎡（低于板块均值5.7%）。业主诚意出售，可配合资金监管+户口迁出担保。支持VR全景+无人机航拍，点击预约今日剩余2个带看时段。	\N	f	ai	t	2026-08-09 14:39:41.917	2026-08-09 14:39:41.917
cmslwshge008di5hcdmi38jgv	房产中介	article	会员权益	\N	\N	【产品种草】	\N	f	ai	t	2026-08-09 14:39:41.919	2026-08-09 14:39:41.919
cmslwshgf008ei5hc7d0yr7g2	房产中介	article	会员权益	\N	\N	不是所有“学区房”都靠谱！这套文教区老牌名校双学籍房：89㎡满五唯一，总价415万，实测步行至学军小学紫金港校区6分钟。附教育局最新划片文件截图+近3年入学排序案例。不渲染焦虑，只呈现可验证的事实。	\N	f	ai	t	2026-08-09 14:39:41.92	2026-08-09 14:39:41.92
cmslwshgg008fi5hc9dz4cxmb	房产中介	article	会员权益	\N	\N	【产品种草】	\N	f	ai	t	2026-08-09 14:39:41.921	2026-08-09 14:39:41.921
cmslwshgh008gi5hc9eg2aubm	房产中介	article	会员权益	\N	\N	萧山市北板块稀缺小户型：62㎡精装修一房，总价228万，首付仅38万起。亮点：地铁2号线盈丰路站步行500米、万科物业、租售比达1:520（年租金12.8万）。附3位真实租客签约记录+月租流水凭证，欢迎查证。	\N	f	ai	t	2026-08-09 14:39:41.922	2026-08-09 14:39:41.922
cmslwshgi008hi5hcmix1m2j9	房产中介	article	会员权益	\N	\N	【客户见证】	\N	f	ai	t	2026-08-09 14:39:41.922	2026-08-09 14:39:41.922
cmslwshgj008ii5hcryrs3qca	房产中介	article	会员权益	\N	\N	【视频实录】陈工（互联网从业者）：“中介说‘随时能贷’，结果征信花了两次。他们提前做预审，发现我有笔消费贷未结清，帮调整方案后一周放款。”——成交周期缩短37%，全程无隐形收费，签约当天即公示资金监管账户。	\N	f	ai	t	2026-08-09 14:39:41.923	2026-08-09 14:39:41.923
cmslwshgk008ji5hccoj8sqju	房产中介	article	会员权益	\N	\N	【客户见证】	\N	f	ai	t	2026-08-09 14:39:41.924	2026-08-09 14:39:41.924
cmslwshgl008ki5hcczbkou4k	房产中介	article	会员权益	\N	\N	【文字手写体】“卖房挂了47天无人问津，他们重新定价+专业拍摄+定向推送企业HR群，第9天就收定金。更意外的是，买家因贷款问题想解约，他们协调原价回购并垫付违约金——这份担当，让我介绍6个同事找他们。	\N	f	ai	t	2026-08-09 14:39:41.925	2026-08-09 14:39:41.925
cmslwshgm008li5hc4bxmdock	房产中介	article	会员权益	\N	\N	【客户见证】	\N	f	ai	t	2026-08-09 14:39:41.926	2026-08-09 14:39:41.926
cmslwshgn008mi5hcqj0kocen	房产中介	article	会员权益	\N	\N	【聊天截图节选】客户问：“你们敢不敢签‘差价返还承诺书’？”我们当场签署并公证：若成交价低于同小区近30天最高成交价，差额100%退还。目前已履行3次，累计返还11.6万元。信任，从敢亮底牌开始。	\N	f	ai	t	2026-08-09 14:39:41.927	2026-08-09 14:39:41.927
cmslwshgo008ni5hcu8kqsu7z	房产中介	article	会员权益	\N	\N	【节假日活动】	\N	f	ai	t	2026-08-09 14:39:41.928	2026-08-09 14:39:41.928
cmslwshgp008oi5hc9ngcrsry	房产中介	article	会员权益	\N	\N	中秋团圆季｜“安心安家”行动启动：9月15日-10月7日，凡签约二手房客户，免费获赠①定制月饼礼盒（含购房祝福卡）②房产交易全流程进度可视化小程序③节后子女入学材料预审服务。名额限前30组，扫码锁定权益。	\N	f	ai	t	2026-08-09 14:39:41.929	2026-08-09 14:39:41.929
cmslwshgp008pi5hcq2w89zdy	房产中介	article	会员权益	\N	\N	【节假日活动】	\N	f	ai	t	2026-08-09 14:39:41.93	2026-08-09 14:39:41.93
cmslwshgq008qi5hchu75xz9r	房产中介	article	会员权益	\N	\N	国庆黄金周｜我们不放假，但换种方式服务：每天10:00/15:00开放“透明直播间”，实时带看热门板块（含价格牌特写、产证信息打码展示、邻居访谈片段）。评论区抽3人送《杭州购房政策速查手册》纸质版（含2024年最新限购/落户细则）。	\N	f	ai	t	2026-08-09 14:39:41.931	2026-08-09 14:39:41.931
cmslwshgr008ri5hci3m8nhui	房产中介	article	会员权益	\N	\N	【节假日活动】	\N	f	ai	t	2026-08-09 14:39:41.932	2026-08-09 14:39:41.932
cmslwshgs008si5hc0iu553x0	房产中介	article	会员权益	\N	\N	春节返乡潮｜专为外地购房者设“极速响应通道”：高铁票订单截图+购房意向登记，即享①远程视频尽调（律师在线见证）②春节后7日内完成网签③赠送返程车票补贴200元。老家有房？我们帮您同步挂牌，无缝衔接。	\N	f	ai	t	2026-08-09 14:39:41.932	2026-08-09 14:39:41.932
cmslwshgt008ti5hcwjn9lkuj	房产中介	article	会员权益	\N	\N	【品牌故事】	\N	f	ai	t	2026-08-09 14:39:41.933	2026-08-09 14:39:41.933
cmslwshgv008ui5hc8blwn0zk	房产中介	article	会员权益	\N	\N	2016年，我们3人挤在凤起路15㎡办公室，第一单成交后，客户说：“你们连契税怎么算都手写给我，比计算器还准。”从此立下铁律：所有报价单必须标注计算公式；所有承诺必须写进补充协议；所有房源必须本人实地复核。	\N	f	ai	t	2026-08-09 14:39:41.936	2026-08-09 14:39:41.936
cmslwshgw008vi5hc49wkqkyt	房产中介	article	会员权益	\N	\N	【品牌故事】	\N	f	ai	t	2026-08-09 14:39:41.937	2026-08-09 14:39:41.937
cmslwshgy008wi5hca4kgeda4	房产中介	article	会员权益	\N	\N	2020年疫情封控期，我们为滞留客户连夜手绘《线上过户操作指南》，用17张流程图+语音备注，帮63户完成“不见面”过户。后来那本册子被住建部门收录为基层服务范本。专业，是危机时仍能托底的能力。	\N	f	ai	t	2026-08-09 14:39:41.938	2026-08-09 14:39:41.938
cmslwshgz008xi5hc8ok951un	房产中介	article	会员权益	\N	\N	【品牌故事】	\N	f	ai	t	2026-08-09 14:39:41.939	2026-08-09 14:39:41.939
cmslwshh0008yi5hcjjmvjkuz	房产中介	article	会员权益	\N	\N	去年暴雨夜，客户签约后突遇房东反悔。我们调取历史挂牌记录、沟通录音、资金流水，48小时内完成证据链固化，推动调解成功。没打一场官司，客户多拿12万补偿。真实力，不在广告里，在每一次挺身而出的细节中。	\N	f	ai	t	2026-08-09 14:39:41.94	2026-08-09 14:39:41.94
cmslwsu57008zi5hcqb3401go	房产中介	topic	\N	\N	春节返乡置业指南：哪些板块房价稳、配套全、通勤快？实拍2024年返乡客最关注的5个刚需盘	\N	\N	f	ai	t	2026-08-09 14:39:58.363	2026-08-09 14:39:58.363
cmslwsu590090i5hc0lsa1r2a	房产中介	topic	\N	\N	3月学区房窗口期来了！教育局最新划片草案解读+近3年对口小学升学率对比（附真实挂牌学区房）	\N	\N	f	ai	t	2026-08-09 14:39:58.366	2026-08-09 14:39:58.366
cmslwsu5a0091i5hcr0ei7yph	房产中介	topic	\N	\N	清明小长假看房避坑清单：中介不会主动说的“隐形采光死角”实测图+视频	\N	\N	f	ai	t	2026-08-09 14:39:58.367	2026-08-09 14:39:58.367
cmslwsu5b0092i5hc30vzpbtw	房产中介	topic	\N	\N	4月二手房交易税费新政落地！买卖双方各省多少钱？手把手算清2024最新个税/契税/增值税	\N	\N	f	ai	t	2026-08-09 14:39:58.367	2026-08-09 14:39:58.367
cmslwsu5c0093i5hcqrlxeosm	房产中介	topic	\N	\N	五一前笋盘速递：房东急售、满五唯一、可随时过户的12套真实在售房源（带产权证/抵押状态截图）	\N	\N	f	ai	t	2026-08-09 14:39:58.368	2026-08-09 14:39:58.368
cmslwsu5c0094i5hcn4u52ru4	房产中介	topic	\N	\N	6月高考季特别策划：离重点高中步行10分钟的“陪读小户型”合集，租金回报率实测数据公开	\N	\N	f	ai	t	2026-08-09 14:39:58.369	2026-08-09 14:39:58.369
cmslwsu5d0095i5hcyh2u3gwp	房产中介	topic	\N	\N	毕业季租房指南：应届生签约前必查的5项条款（押金退还条件/维修责任/转租限制），附标准合同批注版	\N	\N	f	ai	t	2026-08-09 14:39:58.37	2026-08-09 14:39:58.37
cmslwsu5e0096i5hcpogcvfj3	房产中介	topic	\N	\N	7月高温看房体验实录：同一套房源上午10点vs下午3点实测体感温度+空调耗电对比	\N	\N	f	ai	t	2026-08-09 14:39:58.37	2026-08-09 14:39:58.37
cmslwsu5f0097i5hcyn58re8c	房产中介	topic	\N	\N	暑期置换高峰来临：卖旧买新如何无缝衔接？资金监管+网签+贷款预审全流程时间轴（含官方预约入口）	\N	\N	f	ai	t	2026-08-09 14:39:58.371	2026-08-09 14:39:58.371
cmslwsu5g0098i5hck16e4zc9	房产中介	topic	\N	\N	8月台风季房屋安全自查清单：老小区外墙空鼓/阳台渗水/电路老化3大隐患实拍诊断图	\N	\N	f	ai	t	2026-08-09 14:39:58.372	2026-08-09 14:39:58.372
cmslwsu5g0099i5hci8d5oykw	房产中介	topic	\N	\N	教师节专题：教育系统员工专属购房通道开启！合作校方认证房源+额外服务承诺（附签约见证视频）	\N	\N	f	ai	t	2026-08-09 14:39:58.373	2026-08-09 14:39:58.373
cmslwsu5h009ai5hch68ffh1q	房产中介	topic	\N	\N	9月中秋返乡潮前夜：县城改善型买家最纠结的3个问题——要不要留一线房产？县城新房值不值得买？	\N	\N	f	ai	t	2026-08-09 14:39:58.374	2026-08-09 14:39:58.374
cmslwsu5i009bi5hcvauhg0r1	房产中介	topic	\N	\N	国庆黄金周带看复盘：7天累计带看86组，成交率最高的3类户型+对应客户画像（脱敏真实聊天记录节选）	\N	\N	f	ai	t	2026-08-09 14:39:58.374	2026-08-09 14:39:58.374
cmslwsu5j009ci5hcxxq27omp	房产中介	topic	\N	\N	10月二手房指导价松动信号？对比深圳/成都/杭州三城最新挂牌价变化曲线，本地市场真实供需数据	\N	\N	f	ai	t	2026-08-09 14:39:58.375	2026-08-09 14:39:58.375
cmslwsu5j009di5hcrjj0a01b	房产中介	topic	\N	\N	霜降前后装修旺季提醒：二手房翻新前务必做的2项房屋结构检测（附合作检测机构报价单）	\N	\N	f	ai	t	2026-08-09 14:39:58.376	2026-08-09 14:39:58.376
cmslwsu5k009ei5hcgcoxj9c7	房产中介	topic	\N	\N	双11房产服务节：免费验房/贷款预审/税费精算三项服务限时开放（限前50名，带预约二维码）	\N	\N	f	ai	t	2026-08-09 14:39:58.376	2026-08-09 14:39:58.376
cmslwsu5l009fi5hcl4k21a91	房产中介	topic	\N	\N	立冬后供暖季来临：集中供暖VS独立地暖二手房怎么选？10个小区实测室温+采暖费账单公开	\N	\N	f	ai	t	2026-08-09 14:39:58.377	2026-08-09 14:39:58.377
cmslwsu5l009gi5hcedjbdi8r	房产中介	topic	\N	\N	12月年终置换高峰：用公积金冲还贷+商贷组合方案，月供直降2300元的真实案例拆解（附银行审批截图）	\N	\N	f	ai	t	2026-08-09 14:39:58.378	2026-08-09 14:39:58.378
cmslwsu5m009hi5hcks3folxl	房产中介	topic	\N	\N	元旦跨年特辑：2024年本地楼市关键词预测（政策/库存/地价/二手房挂牌量）+我们团队全年成交数据公示	\N	\N	f	ai	t	2026-08-09 14:39:58.378	2026-08-09 14:39:58.378
cmslwsu5m009ii5hcea7lf1n5	房产中介	topic	\N	\N	春节前结款高峰提醒：房东收尾款前必须确认的4个节点（资金监管解冻/户口迁出/物业交割/钥匙移交）	\N	\N	f	ai	t	2026-08-09 14:39:58.379	2026-08-09 14:39:58.379
cmslwsu5n009ji5hc28j6uhxl	房产中介	topic	\N	\N	情人节不只送花：为伴侣买房的5个务实考量——收入证明怎么开？共同还款协议怎么签？	\N	\N	f	ai	t	2026-08-09 14:39:58.379	2026-08-09 14:39:58.379
cmslwsu5o009ki5hcpe9iyg4v	房产中介	topic	\N	\N	两会后政策速递：2024保障性住房建设规划落地影响分析，哪些片区将新增配售型房源？	\N	\N	f	ai	t	2026-08-09 14:39:58.38	2026-08-09 14:39:58.38
cmslwsu5o009li5hc0jzc9oc8	房产中介	topic	\N	\N	清明祭扫顺路看房：陵园周边3公里内宜居改善盘测评（噪音/绿化/公交接驳实测）	\N	\N	f	ai	t	2026-08-09 14:39:58.381	2026-08-09 14:39:58.381
cmslwsu5p009mi5hcoosr3w3w	房产中介	topic	\N	\N	五一劳动节致敬经纪人：我们每天走多少步？拍多少张图？核验几份产调？真实工作日志公开	\N	\N	f	ai	t	2026-08-09 14:39:58.382	2026-08-09 14:39:58.382
cmslwsu5q009ni5hchfkszu48	房产中介	topic	\N	\N	618年中大促：开发商让利+中介补贴双重叠加，哪些楼盘真降价？附近3个月同户型成交价截图	\N	\N	f	ai	t	2026-08-09 14:39:58.383	2026-08-09 14:39:58.383
cmslwsu5r009oi5hc4hag40as	房产中介	topic	\N	\N	七夕单身置业计划：总价150万内地铁上盖一居室，月供≈一杯咖啡钱（含贷款计算器链接）	\N	\N	f	ai	t	2026-08-09 14:39:58.383	2026-08-09 14:39:58.383
cmslwsu5s009pi5hc68f2d2qy	房产中介	topic	\N	\N	开学季二手学区房冷静期观察：8月挂牌激增37%，但实际成交周期拉长至42天，为什么？	\N	\N	f	ai	t	2026-08-09 14:39:58.384	2026-08-09 14:39:58.384
cmslwsu5s009qi5hc5qfk7lzb	房产中介	topic	\N	\N	中秋前“以旧换新”政策细则落地：参与房企名单+置换补贴申领流程图（附我们已帮客户领取成功凭证）	\N	\N	f	ai	t	2026-08-09 14:39:58.385	2026-08-09 14:39:58.385
cmslwsu5t009ri5hc6chfpsqw	房产中介	topic	\N	\N	国庆后房贷利率再下调：LPR-30BP执行首周，我们帮客户抢到最低4.0%利率的5个关键动作	\N	\N	f	ai	t	2026-08-09 14:39:58.385	2026-08-09 14:39:58.385
cmslwsu5u009si5hcuq1q3kjl	房产中介	topic	\N	\N	冬至进补不如“进住”：年底冲刺特价房清单（开发商底价授权书+中介服务承诺函双公开）	\N	\N	f	ai	t	2026-08-09 14:39:58.386	2026-08-09 14:39:58.386
cmslwt6an009ti5hcahtahi92	房产中介	image_prompt	\N	\N	\N	真实房源实拍：现代简约三居室客厅，阳光透过落地窗洒在浅灰布艺沙发与原木茶几上，窗外可见城市天际线，ins风构图，柔和莫兰迪色调，干净留白，俯视45度角	\N	f	ai	t	2026-08-09 14:40:14.111	2026-08-09 14:40:14.111
cmslwt6ap009ui5hccng1qya4	房产中介	image_prompt	\N	\N	\N	真实房源实拍：上海静安区老洋房一楼客厅，复古雕花石膏线、深胡桃色实木地板、皮质单人沙发配绿植，写实光影，自然光+局部暖光补光，细节清晰，中景平视	\N	f	ai	t	2026-08-09 14:40:14.114	2026-08-09 14:40:14.114
cmslwt6ar009vi5hcaevz4l4t	房产中介	image_prompt	\N	\N	\N	真实房源实拍：深圳南山科技园精装小户型厨房，白色哑光橱柜+岩板台面+嵌入式冰箱，国潮元素融入——青花瓷纹样冰箱贴、水墨风“家”字挂画，暖光氛围，微距特写	\N	f	ai	t	2026-08-09 14:40:14.116	2026-08-09 14:40:14.116
cmslwt6at009wi5hc7wxb6334	房产中介	image_prompt	\N	\N	\N	社区型中介门店外立面，浅米色墙砖+深灰金属招牌（带LOGO），门口摆放两盆琴叶榕与木质欢迎立牌，ins风滤镜，低饱和+轻微胶片颗粒，广角仰拍突出亲和感	\N	f	ai	t	2026-08-09 14:40:14.117	2026-08-09 14:40:14.117
cmslwt6au009xi5hcmqli8o4s	房产中介	image_prompt	\N	\N	\N	社区型中介门店内景，开放式前台+三人咨询区（中介穿衬衫佩戴工牌，客户看平板展示房源），玻璃幕墙透进自然光，写实风格，高分辨率，焦点清晰在签约文件与电子屏房源图上	\N	f	ai	t	2026-08-09 14:40:14.118	2026-08-09 14:40:14.118
cmslwt6av009yi5hc4dh41910	房产中介	image_prompt	\N	\N	\N	社区型中介门店春节装饰实景：红底烫金“福”字门贴、灯笼串、柜台前手写春联“诚信为本 服务至诚”，国潮插画风融合摄影质感，暖红金主色，对称构图，中景	\N	f	ai	t	2026-08-09 14:40:14.119	2026-08-09 14:40:14.119
cmslwt6aw009zi5hc8fk12gr4	房产中介	image_prompt	\N	\N	\N	周末安心看房日”活动海报：三位不同年龄客户并肩站在地铁口旁新盘围挡前，手持定制帆布包与房源手册，ins风拼贴设计，浅蓝渐变背景+手绘地铁图标与房屋剪影	\N	f	ai	t	2026-08-09 14:40:14.12	2026-08-09 14:40:14.12
cmslwt6ax00a0i5hc028ymvi0	房产中介	image_prompt	\N	\N	\N	税费测算公益讲座”活动现场实拍：社区中心教室，长桌摆满计算器、打印版《二手房交易成本清单》、讲师手持翻页笔讲解PPT，写实纪实风格，现场自然光，中景抓拍互动瞬间	\N	f	ai	t	2026-08-09 14:40:14.121	2026-08-09 14:40:14.121
cmslwt6ay00a1i5hcsemgw6cl	房产中介	image_prompt	\N	\N	\N	老带新享万元佣金减免”宣传海报：水墨晕染背景中浮现一对握手剪影，左侧印章式“信”字+右侧毛笔字“荐者有礼”，国潮设计，朱砂红+宣纸底纹，居中排版，留白呼吸感	\N	f	ai	t	2026-08-09 14:40:14.122	2026-08-09 14:40:14.122
cmslwt6az00a2i5hcuqaurfry	房产中介	image_prompt	\N	\N	\N	客户签约见证照：杭州西湖区客户夫妇与经纪人三方在签约室签署合同，桌上摊开产证复印件、身份证、钢笔与印泥盒，写实风格，柔焦背景突出人物表情与文件细节，平视中景	\N	f	ai	t	2026-08-09 14:40:14.123	2026-08-09 14:40:14.123
cmslwt6b000a3i5hcsagdvhli	房产中介	image_prompt	\N	\N	\N	客户交房感动瞬间：苏州工业园区业主接过钥匙的特写，手部动作清晰，钥匙串挂有“平安”小挂饰，背后是已清洁完毕的新房玄关，ins风情绪捕捉，浅焦+暖调滤镜	\N	f	ai	t	2026-08-09 14:40:14.125	2026-08-09 14:40:14.125
cmslwt6b100a4i5hclrgbxi6a	房产中介	image_prompt	\N	\N	\N	客户转介绍合影：宁波鄞州老客户带新朋友走进门店，四人站于品牌文化墙前微笑比耶，墙上展示“已服务327个家庭”数据牌与手写感谢卡，国潮插画叠加实拍，祥云边框+金色字体点缀	\N	f	ai	t	2026-08-09 14:40:14.126	2026-08-09 14:40:14.126
cmslwt6b300a5i5hcvors19un	房产中介	image_prompt	\N	\N	\N	秋日社区漫步氛围图：中介顾问与客户并肩走在银杏大道上，顾问手持平板展示周边学区地图，客户指着路标微笑，ins风电影感色调，逆光发丝光，浅景深	\N	f	ai	t	2026-08-09 14:40:14.127	2026-08-09 14:40:14.127
cmslwt6b400a6i5hcedc7edjv	房产中介	image_prompt	\N	\N	\N	深夜加班整理房源资料场景：独立办公室台灯下，经纪人伏案核对产调报告与VR截图，咖啡杯旁贴着便利贴“张女士·滨江改善需求”，写实静谧氛围，暖冷光对比，微距桌面视角	\N	f	ai	t	2026-08-09 14:40:14.129	2026-08-09 14:40:14.129
cmslwt6b500a7i5hcfuqq6mc1	房产中介	image_prompt	\N	\N	\N	烟火气社区生活氛围：傍晚小区儿童乐园旁，中介举手机帮客户拍摄“步行5分钟到校”实景视频，背景有跳绳孩子、归家老人、便利店暖光招牌，国潮色块拼接构图，橙黄紫撞色+手绘对话框标注“真·步行实测	\N	f	ai	t	2026-08-09 14:40:14.13	2026-08-09 14:40:14.13
cmslwtlzy00a8i5hcykxjn8pu	婚庆摄影	title	数字	数字	3个被97%新人忽略的成片雷区，第2个修图师都不好意思说	\N	\N	f	ai	t	2026-08-09 14:40:34.451	2026-08-09 14:40:34.451
cmslwtm0100a9i5hc7rig613b	婚庆摄影	title	反差	反差	5张原图直出vs精修对比图，我们敢把底片全给你看	\N	\N	f	ai	t	2026-08-09 14:40:34.465	2026-08-09 14:40:34.465
cmslwtm0200aai5hcsghnkpww	婚庆摄影	title	疑问	疑问	8小时跟拍只收1个价，透明到连化妆补妆都写进合同里	\N	\N	f	ai	t	2026-08-09 14:40:34.466	2026-08-09 14:40:34.466
cmslwtm0300abi5hc0r86q1cb	婚庆摄影	title	痛点	痛点	12对新人选同一家店的真实原因：不是 cheapest，而是最不踩坑	\N	\N	f	ai	t	2026-08-09 14:40:34.467	2026-08-09 14:40:34.467
cmslwtm0400aci5hcczxfmku8	婚庆摄影	title	福利	福利	21天交付周期+双备份云盘，我们用银行级加密存你的人生高光	\N	\N	f	ai	t	2026-08-09 14:40:34.468	2026-08-09 14:40:34.468
cmslwtm0500adi5hckhrpxn3n	婚庆摄影	title	权威数据	权威数据	婚纱照拍完像换头？我们拒绝“脸僵P图”，原生感才是高级感	\N	\N	f	ai	t	2026-08-09 14:40:34.469	2026-08-09 14:40:34.469
cmslwtm0500aei5hc4n02aqql	婚庆摄影	title	悬念	悬念	同样预算，别人拍3套她拍5套：因为我们的套餐不含隐形加项	\N	\N	f	ai	t	2026-08-09 14:40:34.47	2026-08-09 14:40:34.47
cmslwtm0600afi5hcprgh2xep	婚庆摄影	title	共情	共情	化妆师手抖？摄影师跑调？我们签约前先让你试妆+试拍1小时	\N	\N	f	ai	t	2026-08-09 14:40:34.47	2026-08-09 14:40:34.47
cmslwtm0700agi5hckzlk5p3c	婚庆摄影	title	故事	故事	为什么深圳90后新娘连续3年推荐我们？答案藏在客户群聊天记录里	\N	\N	f	ai	t	2026-08-09 14:40:34.471	2026-08-09 14:40:34.471
cmslwtm0700ahi5hci20q31zv	婚庆摄影	title	清单	清单	拍完3个月还没收到成片？我们超期1天赔200，写进电子合同	\N	\N	f	ai	t	2026-08-09 14:40:34.472	2026-08-09 14:40:34.472
cmslwtm0800aii5hc50tf4c1j	婚庆摄影	title	热点	热点	“修图修得不像我”？我们提供3轮免费精修+人脸细节逐帧确认	\N	\N	f	ai	t	2026-08-09 14:40:34.472	2026-08-09 14:40:34.472
cmslwtm0900aji5hcuoeduy7a	婚庆摄影	title	对比	对比	不是所有“轻奢风”都配叫轻奢——真·胶片机实拍+手工调色才敢标价	\N	\N	f	ai	t	2026-08-09 14:40:34.473	2026-08-09 14:40:34.473
cmslwtm0900aki5hcn0k2nc0v	婚庆摄影	title	对比	对比	你敢信吗？这组森系客片全程没开美颜，连发丝都在呼吸	\N	\N	f	ai	t	2026-08-09 14:40:34.474	2026-08-09 14:40:34.474
cmslwtm0a00ali5hcq5tyoj3k	婚庆摄影	title	对比	对比	婚礼当天暴雨改室内，摄影师掏出3套备用方案：预案比流程还厚	\N	\N	f	ai	t	2026-08-09 14:40:34.474	2026-08-09 14:40:34.474
cmslwtm0a00ami5hc3css6h2c	婚庆摄影	title	对比	对比	“你们能拍出我想要的吗？”——翻完这2000+真实客片库再问	\N	\N	f	ai	t	2026-08-09 14:40:34.475	2026-08-09 14:40:34.475
cmslwtm0b00ani5hcmadoly6h	婚庆摄影	title	对比	对比	新娘哭到睫毛膏都没花？不是运气，是化妆师提前3小时做防水测试	\N	\N	f	ai	t	2026-08-09 14:40:34.476	2026-08-09 14:40:34.476
cmslwtm0c00aoi5hc7jnd90b3	婚庆摄影	title	对比	对比	为什么小红书爆款客片，90%都出自我们家二楼摄影棚？	\N	\N	f	ai	t	2026-08-09 14:40:34.476	2026-08-09 14:40:34.476
cmslwtm0d00api5hchxxg4obc	婚庆摄影	title	对比	对比	“说好不加钱，结果选片时多掏了2800？”我们把所有加项印在价目表首页	\N	\N	f	ai	t	2026-08-09 14:40:34.477	2026-08-09 14:40:34.477
cmslwtm0e00aqi5hc1hyp99ol	婚庆摄影	title	对比	对比	从试妆到取片，全程只有1个对接人——你的专属策划师不换岗	\N	\N	f	ai	t	2026-08-09 14:40:34.478	2026-08-09 14:40:34.478
cmslwtm0e00ari5hc1d8r5a17	婚庆摄影	title	对比	对比	她说“不想千篇一律”，我们就为她重搭整套布景，连道具都是手作	\N	\N	f	ai	t	2026-08-09 14:40:34.479	2026-08-09 14:40:34.479
cmslwtm0f00asi5hcxa9zzxo3	婚庆摄影	title	对比	对比	今年最火的“电影感婚礼纪实”，我们已服务47对新人零差评	\N	\N	f	ai	t	2026-08-09 14:40:34.479	2026-08-09 14:40:34.479
cmslwtm0f00ati5hcilbkkfbz	婚庆摄影	title	对比	对比	为什么杭州新人宁愿排队2个月也要约我们档期？真相在成片里	\N	\N	f	ai	t	2026-08-09 14:40:34.48	2026-08-09 14:40:34.48
cmslwtm0g00aui5hc56fwwgsw	婚庆摄影	title	对比	对比	“拍完才发现摄影师总在拍伴娘？”我们签约即签《主视觉聚焦承诺书》	\N	\N	f	ai	t	2026-08-09 14:40:34.48	2026-08-09 14:40:34.48
cmslwtm0h00avi5hcs2l094w2	婚庆摄影	title	对比	对比	你收藏的100张ins风样片，有83张是我们去年实拍的客片	\N	\N	f	ai	t	2026-08-09 14:40:34.482	2026-08-09 14:40:34.482
cmslwtm0i00awi5hcl8qcrfaq	婚庆摄影	title	对比	对比	婚纱照拍完不敢发朋友圈？我们提供「社交友好版」精修+排版建议	\N	\N	f	ai	t	2026-08-09 14:40:34.482	2026-08-09 14:40:34.482
cmslwtm0i00axi5hce0pnlh53	婚庆摄影	title	对比	对比	2024婚摄投诉率TOP3问题，我们全部用服务条款提前兜底	\N	\N	f	ai	t	2026-08-09 14:40:34.483	2026-08-09 14:40:34.483
cmslwtm0j00ayi5hczv6qkkkv	婚庆摄影	title	对比	对比	“他偷偷删了所有修图软件”——新郎说这是他见过最自然的成片	\N	\N	f	ai	t	2026-08-09 14:40:34.483	2026-08-09 14:40:34.483
cmslwtm0j00azi5hc25wl9ezu	婚庆摄影	title	对比	对比	拍摄当天设备故障？我们双机位+备用电池+移动硬盘实时同步	\N	\N	f	ai	t	2026-08-09 14:40:34.484	2026-08-09 14:40:34.484
cmslwtm0k00b1i5hcjeqks39s	婚庆摄影	title	对比	对比	为什么客户说“你们像朋友一样记得我的小习惯”？因为策划本记满17页	\N	\N	f	ai	t	2026-08-09 14:40:34.485	2026-08-09 14:40:34.485
cmslwtm0l00b2i5hc815tbvke	婚庆摄影	title	对比	对比	【真实故事】新娘术后3个月拍婚纱，我们关掉所有闪光灯用手持柔光	\N	\N	f	ai	t	2026-08-09 14:40:34.485	2026-08-09 14:40:34.485
cmslwtm0m00b3i5hckgbzdudb	婚庆摄影	title	对比	对比	【真实故事】暴雨婚礼当天，摄影师蹲守3小时拍到云破日出那帧	\N	\N	f	ai	t	2026-08-09 14:40:34.486	2026-08-09 14:40:34.486
cmslwtm0m00b4i5hcmw8g6qcn	婚庆摄影	title	对比	对比	【真实故事】聋哑新娘全程手语沟通，我们安排双语摄影助理全程陪同	\N	\N	f	ai	t	2026-08-09 14:40:34.487	2026-08-09 14:40:34.487
cmslwtm0n00b5i5hce8djwkxl	婚庆摄影	title	对比	对比	【真实故事】二胎妈妈产后100天，我们用光影弱化腰腹、强化眼神力量	\N	\N	f	ai	t	2026-08-09 14:40:34.487	2026-08-09 14:40:34.487
cmslwtm0n00b6i5hcxewkcw20	婚庆摄影	title	对比	对比	【真实故事】跨国家庭婚礼，我们提前2周飞曼谷搭景+协调当地团队	\N	\N	f	ai	t	2026-08-09 14:40:34.488	2026-08-09 14:40:34.488
cmslwtm0o00b7i5hcx85l2ptu	婚庆摄影	title	对比	对比	婚纱照必拍的7个镜头清单，少1个都算我们服务不到位	\N	\N	f	ai	t	2026-08-09 14:40:34.488	2026-08-09 14:40:34.488
cmslwtm0o00b8i5hccd8csb6k	婚庆摄影	title	对比	对比	化妆师必带的5件私藏工具清单，第4件连专柜都买不到	\N	\N	f	ai	t	2026-08-09 14:40:34.489	2026-08-09 14:40:34.489
cmslwtm0p00b9i5hcb73vwjdq	婚庆摄影	title	对比	对比	婚礼跟拍前必须确认的9件事清单，我们帮你划掉8条	\N	\N	f	ai	t	2026-08-09 14:40:34.489	2026-08-09 14:40:34.489
cmslwtm0p00bai5hcov0o1wde	婚庆摄影	title	对比	对比	客片精修的6个细节标准清单：从耳垂高光到指甲透光度	\N	\N	f	ai	t	2026-08-09 14:40:34.49	2026-08-09 14:40:34.49
cmslwtm0q00bbi5hcvv1e4bzp	婚庆摄影	title	对比	对比	摄影师包里永远装着的4类应急道具清单，雨天/暴晒/停电全覆盖	\N	\N	f	ai	t	2026-08-09 14:40:34.49	2026-08-09 14:40:34.49
cmslwtm0r00bci5hcve9tpmf3	婚庆摄影	title	对比	对比	五一档期告急！最后3组「早鸟锁档」享免费升级胶片机拍摄	\N	\N	f	ai	t	2026-08-09 14:40:34.491	2026-08-09 14:40:34.491
cmslwtm0r00bdi5hcgdvpady5	婚庆摄影	title	对比	对比	现在预约送「情绪急救包」：含防晕妆贴+便携吸管+应急针线盒	\N	\N	f	ai	t	2026-08-09 14:40:34.492	2026-08-09 14:40:34.492
cmslwtm0s00bei5hc2f8nnhvs	婚庆摄影	title	对比	对比	本周档期释放！前5名签约赠「婚礼当天快剪短视频」（24h出片）	\N	\N	f	ai	t	2026-08-09 14:40:34.492	2026-08-09 14:40:34.492
cmslwtm0s00bfi5hcitkll1do	婚庆摄影	title	对比	对比	孕期新娘专享福利：免费延后档期+赠送胎动纪念微纪录片	\N	\N	f	ai	t	2026-08-09 14:40:34.493	2026-08-09 14:40:34.493
cmslwtm0t00bgi5hcg8pxp8wj	婚庆摄影	title	对比	对比	情人节限定｜预约即送「恋爱时间轴」手绘长卷+实体相册内页	\N	\N	f	ai	t	2026-08-09 14:40:34.494	2026-08-09 14:40:34.494
cmslwtm0u00bhi5hccco19ufl	婚庆摄影	title	对比	对比	小红书爆火的“	\N	\N	f	ai	t	2026-08-09 14:40:34.494	2026-08-09 14:40:34.494
cmslwujir00bii5hct55ksdb1	婚庆摄影	article	新客引流	\N	\N	新客引流：刚刷到我们？恭喜你避开“影楼流水线”雷区！我们不拍千篇一律的PS模板，每对新人专属定制拍摄脚本——从试纱时的微表情捕捉，到外景动线设计，连风向、光线、路人密度都提前踩点。最近3位00后新娘说：“终于找到不让我摆‘剪刀手’的摄影师”。私信发送【试纱时间】，免费领《避坑指南+3套风格样片》，限本周前15名。	\N	f	ai	t	2026-08-09 14:41:17.907	2026-08-09 14:41:17.907
cmslwujit00bji5hc2is1u83r	婚庆摄影	article	老客复购	\N	\N	新客引流：你收藏的“高级感婚纱照”，90%来自我们镜头。但别急着划走——我们不做“精修50张送20张”的数字游戏，所有成片真实可查（附上月客户原图直出截图）。现在预约档期，送一对一风格诊断+底片全送+电子相册定制。没有套路，只有“拍完就想发朋友圈”的踏实感。	\N	f	ai	t	2026-08-09 14:41:17.909	2026-08-09 14:41:17.909
cmslwujiu00bki5hc9iwhhl58	婚庆摄影	article	产品种草	\N	\N	新客引流：不是所有婚纱照都叫「情绪纪实」。我们用电影级叙事逻辑拍婚礼日：晨光里妈妈帮你系头纱的手抖，接亲时新郎转身看见你的那一秒失语，敬茶时爸爸悄悄抹眼角……不导演，只等待。点击预约，送《新人情绪捕捉清单》+免费试妆1次（含发型/妆面/礼服搭配建议）。	\N	f	ai	t	2026-08-09 14:41:17.911	2026-08-09 14:41:17.911
cmslwujiv00bli5hcmxxek2jq	婚庆摄影	article	客户见证	\N	\N	老客复购：去年拍完婚纱照的新娘@小满，今年带着闺蜜来订婚照+全家福套餐——她说：“上次修图师连我睫毛膏晕染的弧度都保留了真实感，这次直接把婆婆也拉来拍银婚纪念”。老客复购享优先档期+免基础升级费+赠16寸油画框挂画。爱，值得反复定格。	\N	f	ai	t	2026-08-09 14:41:17.912	2026-08-09 14:41:17.912
cmslwujiw00bmi5hcvasbeduk	婚庆摄影	article	节假日活动	\N	\N	老客复购：很多客人拍完婚纱照会说：“早知道结婚三周年该再拍一次”。现在起，持任意年份成片可享复购特权：5折拍纪念照（限3年内），加赠动态影像短片（30秒电影感混剪），修图标准与当年一致——不换团队，不降品质，只为你和时光同频生长。	\N	f	ai	t	2026-08-09 14:41:17.913	2026-08-09 14:41:17.913
cmslwujix00bni5hcq7vqk44q	婚庆摄影	article	品牌故事	\N	\N	老客复购：我们建了个「成长影像库」：只要你提供过往成片授权，每年生日自动为你生成一张“时光对比图”（如：领证日vs宝宝百天vs三周年），配手写寄语+胶片滤镜。老客专享：复购即送影像库终身会员+实体年历一本（含4张精选照片）。有些爱，越拍越熟。	\N	f	ai	t	2026-08-09 14:41:17.914	2026-08-09 14:41:17.914
cmslwujiz00boi5hcefm7jfi8	婚庆摄影	article	上新公告	\N	\N	产品种草：别再被“轻奢风”“森系风”标签困住！我们真正做的是「人设适配摄影」：职场精英新娘→冷调胶片+建筑几何构图；文艺教师新娘→柔焦逆光+手写信道具；电竞新郎新娘→赛博霓虹+游戏机元素自然植入。3套样片免费发你，帮你判断“这真是我”。	\N	f	ai	t	2026-08-09 14:41:17.915	2026-08-09 14:41:17.915
cmslwujj000bpi5hcdbqvi0mm	婚庆摄影	article	优惠活动	\N	\N	产品种草：为什么我们的「雨天备选方案」被27对新人写进感谢卡？因为真准备了：室内玻璃花房+移动雾化机+3套防水妆容方案+雨声白噪音BGM歌单。不是“下雨就改期”，而是“雨丝垂落时，你睫毛上的水珠比钻石更亮”。点击看真实雨天成片合集。	\N	f	ai	t	2026-08-09 14:41:17.917	2026-08-09 14:41:17.917
cmslwujj200bqi5hc5w2nvs5s	婚庆摄影	article	知识科普	\N	\N	产品种草：我们偷偷给每套服装做了「动态适配测试」：鱼尾裙配微风坡道、齐胸襦裙配青石巷晨雾、西装套装配咖啡馆落地窗流光……试纱时现场演示“同一套衣服在3种光线下怎么拍最显瘦”。不卖概念，只卖“穿上去就知道值”的确定性。	\N	f	ai	t	2026-08-09 14:41:17.918	2026-08-09 14:41:17.918
cmslwujj300bri5hck15zcork	婚庆摄影	article	互动话题	\N	\N	客户见证：@阿哲&圆圆｜2024.3.16 拍摄｜成片交付第7天	\N	f	ai	t	2026-08-09 14:41:17.919	2026-08-09 14:41:17.919
cmslwujjn00cdi5hchjn4igku	婚庆摄影	article	会员权益	\N	\N	▫️最抗拒被要求摆什么姿势？	\N	f	ai	t	2026-08-09 14:41:17.94	2026-08-09 14:41:17.94
cmslwujj400bsi5hcrf40wr0o	婚庆摄影	article	答疑辟谣	\N	\N	修图师拒绝把我P成‘蛇精脸’，坚持保留法令纹和笑纹——说那是我们攒了8年恋爱才长出来的勋章。底片全送，连NG废片都打了水印送给我们当手机壁纸。现在婆婆手机屏保还是我们接亲蹲着系鞋带那张。	\N	f	ai	t	2026-08-09 14:41:17.92	2026-08-09 14:41:17.92
cmslwujj500bti5hcyp6r8wfb	婚庆摄影	article	会员权益	\N	\N	客户见证：@Luna｜2024.5.20 拍摄｜成片交付第3天	\N	f	ai	t	2026-08-09 14:41:17.921	2026-08-09 14:41:17.921
cmslwujj600bui5hck3iqrl3m	婚庆摄影	article	会员权益	\N	\N	全程没签任何附加协议，说好28张精修就28张，结果多送了5张抓拍。化妆师记得我提过‘讨厌假睫毛厚重感’，当天用单簇嫁接代替整排。最感动是交付那天，摄影师把拍摄花絮剪成1分钟vlog塞进U盘——原来我慌张又发光的样子，早被他们温柔存好了。	\N	f	ai	t	2026-08-09 14:41:17.922	2026-08-09 14:41:17.922
cmslwujj700bvi5hcdni5l3c4	婚庆摄影	article	会员权益	\N	\N	客户见证：@大鹏&薇薇｜2023.11.11 拍摄｜成片交付第12天	\N	f	ai	t	2026-08-09 14:41:17.923	2026-08-09 14:41:17.923
cmslwujj800bwi5hctp1teyzi	婚庆摄影	article	会员权益	\N	\N	他们提前3个月帮我们协调老家祠堂拍摄许可，连族谱照片都扫描进电子相册。成片里爷爷摸我头的手背皱纹、爸爸衬衫第三颗纽扣的磨损，都被保留得像纪录片镜头。这不是婚纱照，是我们家族记忆的起点。	\N	f	ai	t	2026-08-09 14:41:17.924	2026-08-09 14:41:17.924
cmslwujj900bxi5hcujxk3fy5	婚庆摄影	article	会员权益	\N	\N	节假日活动：七夕不搞“买一送一”套路！这个七夕，我们做件小事：凡预约8-10月档期新人，免费加拍「七夕限定夜景」——城市天台星光灯串+手写情书特写+双人剪影慢门。成片带专属烫金标：“2024.8.10 我们刚确认过心动”。名额仅33对，手慢无。	\N	f	ai	t	2026-08-09 14:41:17.925	2026-08-09 14:41:17.925
cmslwujj900byi5hchvh8i017	婚庆摄影	article	会员权益	\N	\N	节假日活动：中秋团圆，影像也该“回娘家”。即日起至9月17日，携父母/公婆同拍全家福，享三重心意：① 免费加拍1组传统服饰合影 ② 赠定制月饼礼盒（内含全家福缩略卡） ③ 成片嵌入AR技术——扫码看长辈年轻时老照片叠化动画。爱，从来都是双向奔赴。	\N	f	ai	t	2026-08-09 14:41:17.926	2026-08-09 14:41:17.926
cmslwujjb00bzi5hcuip1056e	婚庆摄影	article	会员权益	\N	\N	节假日活动：圣诞不止有麋鹿和雪橇！我们推出「冬日告白计划」：12.1-12.25预约新人，赠送「雪景模拟拍摄」（恒温影棚+人造雪机+热红酒道具），成片含圣诞手写字体祝福页+实体雪花玻璃球相框。不等真雪，先藏浪漫。	\N	f	ai	t	2026-08-09 14:41:17.927	2026-08-09 14:41:17.927
cmslwujjc00c0i5hcg3jxgf40	婚庆摄影	article	会员权益	\N	\N	品牌故事：2016年，创始人阿哲在自家老相机维修铺里，修坏了一台Mamiya RB67——却意外发现，胶片过期三年后拍出的褪色感，比数码精修更接近“初恋心跳”。从此我们坚持：器材可以更新，但对真实的敬畏不能升级。	\N	f	ai	t	2026-08-09 14:41:17.928	2026-08-09 14:41:17.928
cmslwujjd00c1i5hc1jo3u6f6	婚庆摄影	article	会员权益	\N	\N	品牌故事：我们的修图师团队，平均从业11年，没人做过影楼“一键美颜”培训。第一位修图师曾为纪录片修复抗战老兵影像，她说：“人脸上的沟壑，是时间盖的邮戳，不是待删除的瑕疵。”——这成了我们所有成片的底线。	\N	f	ai	t	2026-08-09 14:41:17.929	2026-08-09 14:41:17.929
cmslwujjd00c2i5hcyjcub1bz	婚庆摄影	article	会员权益	\N	\N	品牌故事：工作室墙上没挂奖状，只钉着37张泛黄便签纸，全是客人写的：“谢谢没让我P掉妊娠纹”“谢谢保留我戴眼镜的样子”“谢谢把轮椅扶手拍成光的延伸”。这些字，比任何金奖牌都沉。	\N	f	ai	t	2026-08-09 14:41:17.93	2026-08-09 14:41:17.93
cmslwujje00c3i5hcxn04xth4	婚庆摄影	article	会员权益	\N	\N	上新公告：全新上线「人生阶段影像包」：从求婚→领证→孕照→宝宝百天→金婚纪念，5个节点无缝衔接。同一摄影师跟拍，统一色调管理，底片云端同步归档。现在预订，享早鸟价+赠家庭影像树状图手绘稿（含所有拍摄时间轴）。	\N	f	ai	t	2026-08-09 14:41:17.931	2026-08-09 14:41:17.931
cmslwujjf00c4i5hcd5g70fjl	婚庆摄影	article	会员权益	\N	\N	上新公告：「素人改造计划」正式开放申请！每月限5组真实素人（非网红/无粉丝基础），免费拍摄+全网宣发+影像版权归属本人。我们只提一个要求：允许记录你卸下社交面具的真实状态。报名通道已开，点击看上期素人成片。	\N	f	ai	t	2026-08-09 14:41:17.932	2026-08-09 14:41:17.932
cmslwujjg00c5i5hcz8mccpbv	婚庆摄影	article	会员权益	\N	\N	上新公告：即日起启用「双摄协同系统」：主摄负责情绪抓取，副摄专攻细节微距（戒指反光/发丝缠绕/袖口褶皱）。成片交付含2组独立视角，可自由组合成电影分镜式画册。首批体验价仅加999元，含双机位花絮视频。	\N	f	ai	t	2026-08-09 14:41:17.933	2026-08-09 14:41:17.933
cmslwujjh00c6i5hc37ul3s7v	婚庆摄影	article	会员权益	\N	\N	优惠活动：618不玩“满减障眼法”！明码标价：婚纱照套餐直降2800元，且承诺——所有降价项目（精修张数/相册页数/相框尺寸）均不缩水。另赠：电子请柬设计×1 + 婚礼当日快修服务×3张 + 延期无忧保障（档期免费顺延3次）。	\N	f	ai	t	2026-08-09 14:41:17.934	2026-08-09 14:41:17.934
cmslwujjj00c7i5hcnb1kjsdt	婚庆摄影	article	会员权益	\N	\N	优惠活动：毕业季特别企划：2024应届毕业生凭学生证/录取通知，享「启程套餐」5折。含：2套正装+2套礼服拍摄、12张精修、A4精装相册×1、底片全送。我们相信：人生第一份重要影像，不该被预算绑架。	\N	f	ai	t	2026-08-09 14:41:17.935	2026-08-09 14:41:17.935
cmslwujjj00c8i5hc0t7akyoo	婚庆摄影	article	会员权益	\N	\N	优惠活动：「早鸟锁档计划」启动：2025年1-6月热门档期，现在支付500元意向金即可锁定价格+优先选片权+免收改期费。意向金可退，但锁定期间涨价部分由我们承担——毕竟，爱不该为通胀买单。	\N	f	ai	t	2026-08-09 14:41:17.936	2026-08-09 14:41:17.936
cmslwujjk00c9i5hcw2za6lwq	婚庆摄影	article	会员权益	\N	\N	知识科普：为什么你总被“精修50张”吸引？真相是：行业默认“精修=重度PS”，而我们定义“精修=精准还原你本真的高光时刻”。比如：保留你晒斑但提亮肤色通透感，弱化眼袋但强化眼神光，修饰肩颈线条但不改变骨相结构。	\N	f	ai	t	2026-08-09 14:41:17.937	2026-08-09 14:41:17.937
cmslwujjl00cai5hczqizuq8e	婚庆摄影	article	会员权益	\N	\N	知识科普：所谓“底片全送”，不是发个20GB压缩包了事。我们提供：① 原始RAW文件（保留全部光影信息） ② JPG直出预览版（方便快速选片） ③ 所有废片标注说明（如“逆光过曝”“表情未到位”）。影像主权，本就该属于你。	\N	f	ai	t	2026-08-09 14:41:17.938	2026-08-09 14:41:17.938
cmslwujjm00cbi5hc0ggspage	婚庆摄影	article	会员权益	\N	\N	知识科普：警惕“免费试妆”陷阱！真正专业的试妆包含：① 根据你肤质测试3款粉底持妆力 ② 搭配当日礼服做色彩校准 ③ 记录你眨眼/大笑时的妆面变化点。我们试妆全程录像，不满意当场重做——毕竟，脸，比成片更不能返工。	\N	f	ai	t	2026-08-09 14:41:17.938	2026-08-09 14:41:17.938
cmslwujjn00cci5hce9c9rals	婚庆摄影	article	会员权益	\N	\N	互动话题：评论区交出你的“拍照雷区”👇	\N	f	ai	t	2026-08-09 14:41:17.939	2026-08-09 14:41:17.939
cmslwujjp00cfi5hcyx6w6zvo	婚庆摄影	article	会员权益	\N	\N	▫️如果给婚纱照加一句台词，你想说什么？	\N	f	ai	t	2026-08-09 14:41:17.942	2026-08-09 14:41:17.942
cmslwujjq00cgi5hcz9l1gizt	婚庆摄影	article	会员权益	\N	\N	抽3位走心留言，送《新人沟通手册》（含摄影师/化妆师/策划师真实问答录音）。	\N	f	ai	t	2026-08-09 14:41:17.943	2026-08-09 14:41:17.943
cmslwujjr00chi5hc99g1m739	婚庆摄影	article	会员权益	\N	\N	互动话题：发起#我的真实比精修好看#挑战！	\N	f	ai	t	2026-08-09 14:41:17.943	2026-08-09 14:41:17.943
cmslwuwqz00cii5hcr9uzalk4	婚庆摄影	topic	\N	\N	春日樱花季｜新娘试纱照拍完当场哭湿三包纸巾：我们为什么坚持「不P脸」修图原则	\N	\N	f	ai	t	2026-08-09 14:41:35.051	2026-08-09 14:41:35.051
cmslwuwr000cji5hc4baruzy0	婚庆摄影	topic	\N	\N	五一档期告急｜3月锁定拍摄日送手作喜糖盒：附赠10张未修原图自查清单	\N	\N	f	ai	t	2026-08-09 14:41:35.053	2026-08-09 14:41:35.053
cmslwuwr100cki5hcslnky3fa	婚庆摄影	topic	\N	\N	清明小长假｜带爸妈拍的全家福，比婚纱照更值得存10年（客片实录+父母采访）	\N	\N	f	ai	t	2026-08-09 14:41:35.054	2026-08-09 14:41:35.054
cmslwuwr200cli5hc8dtzy3jp	婚庆摄影	topic	\N	\N	五一前最后28个档期”倒计时｜拒绝套路加项：我们的套餐价=成片精修+底片全送+无隐形消费清单	\N	\N	f	ai	t	2026-08-09 14:41:35.054	2026-08-09 14:41:35.054
cmslwuwr200cmi5hcfezhbytr	婚庆摄影	topic	\N	\N	立夏前夜｜在稻田边拍的森系婚照，新娘说“终于找到不端着的自己”（全程无摆拍花絮）	\N	\N	f	ai	t	2026-08-09 14:41:35.055	2026-08-09 14:41:35.055
cmslwuwr300cni5hc110rdjq6	婚庆摄影	topic	\N	\N	618提前购｜下单即锁摄影师档期+免费重拍1次：不是噱头，是去年赔了7单的教训	\N	\N	f	ai	t	2026-08-09 14:41:35.055	2026-08-09 14:41:35.055
cmslwuwr300coi5hcywep4d89	婚庆摄影	topic	\N	\N	高考结束季｜准新人专场：学生证享95折+赠送「毕业×婚礼」双主题胶片拼贴相册	\N	\N	f	ai	t	2026-08-09 14:41:35.056	2026-08-09 14:41:35.056
cmslwuwr400cpi5hccxwnznni	婚庆摄影	topic	\N	\N	七夕预告｜今年不拍牵手剪影！我们用微距镜头记录戒指内圈刻字、袖口针脚、睫毛颤动的0.3秒	\N	\N	f	ai	t	2026-08-09 14:41:35.056	2026-08-09 14:41:35.056
cmslwuwr400cqi5hcu7fspsl3	婚庆摄影	topic	\N	\N	台风天改期实录｜暴雨中扛设备进民宿拍出的雨雾感成片，附天气应急拍摄SOP	\N	\N	f	ai	t	2026-08-09 14:41:35.057	2026-08-09 14:41:35.057
cmslwuwr500cri5hctgiv95eo	婚庆摄影	topic	\N	\N	七夕档爆满｜但留了5个“反向档期”给临时决定结婚的你们（8-10月优先排）	\N	\N	f	ai	t	2026-08-09 14:41:35.057	2026-08-09 14:41:35.057
cmslwuwr500csi5hc0emsm34a	婚庆摄影	topic	\N	\N	中秋家宴纪实｜在奶奶老宅拍的暖光婚照，灶台、搪瓷杯、手写菜单全入镜（非布景）	\N	\N	f	ai	t	2026-08-09 14:41:35.058	2026-08-09 14:41:35.058
cmslwuwr600cti5hcpmmlskyp	婚庆摄影	topic	\N	\N	国庆黄金周｜拒绝流水线机位！每位新人定制3个专属记忆锚点（比如你求婚时的咖啡渍位置）	\N	\N	f	ai	t	2026-08-09 14:41:35.058	2026-08-09 14:41:35.058
cmslwuwr600cui5hc2bzul4w8	婚庆摄影	topic	\N	\N	双十一冷静期｜我们把“后悔权”写进合同：72小时内可无理由退定金（附真实退款截图）	\N	\N	f	ai	t	2026-08-09 14:41:35.059	2026-08-09 14:41:35.059
cmslwuwr700cvi5hcsxxk7gu7	婚庆摄影	topic	\N	\N	小雪节气｜室内暖光棚实拍：毛衣起球、发丝飞翘、睫毛膏晕染…都保留（审美共识问卷公开）	\N	\N	f	ai	t	2026-08-09 14:41:35.059	2026-08-09 14:41:35.059
cmslwuwr700cwi5hcn9wz3e32	婚庆摄影	topic	\N	\N	跨年倒数夜｜2024最后一组客片交付现场：新娘打开U盘瞬间，新郎偷偷擦了三次眼睛	\N	\N	f	ai	t	2026-08-09 14:41:35.06	2026-08-09 14:41:35.06
cmslwuwr800cxi5hc2copzjap	婚庆摄影	topic	\N	\N	元旦开工日｜公布2024全年废片率TOP3原因：对焦失误/表情管理翻车/打光过曝（附改进方案）	\N	\N	f	ai	t	2026-08-09 14:41:35.06	2026-08-09 14:41:35.06
cmslwuwr900cyi5hctpogg79b	婚庆摄影	topic	\N	\N	情人节限定｜不拍玫瑰与蜡烛：用外卖单、电影票根、聊天截图做相册内页（客户授权实拍）	\N	\N	f	ai	t	2026-08-09 14:41:35.061	2026-08-09 14:41:35.061
cmslwuwr900czi5hccj7ibvkq	婚庆摄影	topic	\N	\N	雨水节气｜江南烟雨里的油纸伞婚照，修图师自曝“调色参数全公开”：拒绝AI一键美颜	\N	\N	f	ai	t	2026-08-09 14:41:35.062	2026-08-09 14:41:35.062
cmslwuwra00d0i5hc6xadwowi	婚庆摄影	topic	\N	\N	三八妇女节｜新娘主导选片权：她划掉的23张，我们都存档但永不外发（附沟通录音节选）	\N	\N	f	ai	t	2026-08-09 14:41:35.062	2026-08-09 14:41:35.062
cmslwuwra00d1i5hc2sqwshpv	婚庆摄影	topic	\N	\N	春分日｜户外拍摄防晒指南：SPF50+物理遮挡+冰镇湿毛巾+摄影师随身补妆包实录	\N	\N	f	ai	t	2026-08-09 14:41:35.063	2026-08-09 14:41:35.063
cmslwuwrb00d2i5hcabmh4il8	婚庆摄影	topic	\N	\N	清明踏青季｜山野间拍的轻婚纱，化妆师蹲3小时等云隙光，只为那一秒自然高光	\N	\N	f	ai	t	2026-08-09 14:41:35.063	2026-08-09 14:41:35.063
cmslwuwrb00d3i5hcx1nxd6g5	婚庆摄影	topic	\N	\N	五一劳动节｜跟拍摄影师的一天：7:20到岗/127次弯腰调整机位/3次帮新娘扶裙摆防踩	\N	\N	f	ai	t	2026-08-09 14:41:35.064	2026-08-09 14:41:35.064
cmslwuwrc00d4i5hcp4wrl60y	婚庆摄影	topic	\N	\N	端午限定｜龙舟赛背景下的中式婚照，非遗香囊入镜，修图保留汗珠与红绳勒痕	\N	\N	f	ai	t	2026-08-09 14:41:35.064	2026-08-09 14:41:35.064
cmslwuwrc00d5i5hcxinn5q7q	婚庆摄影	topic	\N	\N	夏至最长日照｜凌晨4点海边等待第一缕光，新娘素颜+海风凌乱发丝成片主视觉	\N	\N	f	ai	t	2026-08-09 14:41:35.065	2026-08-09 14:41:35.065
cmslwuwrd00d6i5hc3o61qfq3	婚庆摄影	topic	\N	\N	七夕非遗专题｜和苏州绣娘合作：把婚纱照绣进团扇，线稿由新人手绘（过程全记录）	\N	\N	f	ai	t	2026-08-09 14:41:35.066	2026-08-09 14:41:35.066
cmslwuwre00d7i5hc8vxtepsz	婚庆摄影	topic	\N	\N	教师节温情向｜校园主题婚照：黑板公式是你俩初遇的日期，课桌刻痕是恋爱时长	\N	\N	f	ai	t	2026-08-09 14:41:35.066	2026-08-09 14:41:35.066
cmslwuwre00d8i5hcgtkgw7wq	婚庆摄影	topic	\N	\N	中秋团圆局｜“四代同堂”全家福拍摄手记：从哄睡宝宝到劝服爷爷摘掉老花镜	\N	\N	f	ai	t	2026-08-09 14:41:35.067	2026-08-09 14:41:35.067
cmslwuwrf00d9i5hcqai0encj	婚庆摄影	topic	\N	\N	双11理性消费｜我们拆解一套19800元套餐：每张精修图成本/单次补光耗电/化妆师工时明细	\N	\N	f	ai	t	2026-08-09 14:41:35.067	2026-08-09 14:41:35.067
cmslwuwrf00dai5hc65zl23xf	婚庆摄影	topic	\N	\N	冬至暖光计划｜暖气片旁拍的居家婚照，毛毯褶皱、猫尾巴入镜、煮泡面蒸汽都算构图元素	\N	\N	f	ai	t	2026-08-09 14:41:35.068	2026-08-09 14:41:35.068
cmslwuwrg00dbi5hc10axh8ck	婚庆摄影	topic	\N	\N	跨年烟火实拍｜不用无人机不借场地：就在自家阳台，用慢门捕捉烟花流光与戒指反光	\N	\N	f	ai	t	2026-08-09 14:41:35.068	2026-08-09 14:41:35.068
cmslwva0n00dci5hcapmipq3j	婚庆摄影	image_prompt	\N	\N	\N	一张ins风婚庆摄影产品展示图：柔光木质背景，三组精致婚纱照样册平铺，搭配干花、胶片相机与手写价目卡，浅米色系，干净留白，自然光影，俯拍构图	\N	f	ai	t	2026-08-09 14:41:52.246	2026-08-09 14:41:52.246
cmslwva0p00ddi5hcpl5uxai9	婚庆摄影	image_prompt	\N	\N	\N	一张写实风婚庆摄影产品展示图：影楼柜台实景，摄影师手持成片相框讲解，相框内为高清新人肖像，背景陈列不同尺寸相册与金属相框样品，光线均匀，细节清晰，中景视角	\N	f	ai	t	2026-08-09 14:41:52.25	2026-08-09 14:41:52.25
cmslwva0r00dei5hci1y4lgsg	婚庆摄影	image_prompt	\N	\N	\N	一张国潮风婚庆摄影产品展示图：水墨晕染底纹上浮雕烫金“囍”字，环绕摆放青瓷相框、云锦纹样相册、红木雕花摆台，配毛笔书写的套餐名称，朱砂红与檀木色主调，对称构图	\N	f	ai	t	2026-08-09 14:41:52.252	2026-08-09 14:41:52.252
cmslwva0t00dfi5hc5ms5z0hi	婚庆摄影	image_prompt	\N	\N	\N	一张ins风门店环境图：阳光透过落地窗洒在原木长桌与绿植墙之间，桌上散落胶片机、咖啡杯、手绘风格服务手册，门头招牌简约英文+中文小字，浅灰白墙面，氛围松弛有质感	\N	f	ai	t	2026-08-09 14:41:52.254	2026-08-09 14:41:52.254
cmslwva0v00dgi5hcecefaujb	婚庆摄影	image_prompt	\N	\N	\N	一张写实风门店环境图：真实影楼接待区实拍，前台小姐姐微笑递上定制方案册，背后是灯光调试中的拍摄区（柔光箱、反光板、试衣镜），玻璃门可见外景花园布景，自然纪实感，中景带环境叙事	\N	f	ai	t	2026-08-09 14:41:52.255	2026-08-09 14:41:52.255
cmslwva0x00dhi5hcss03ayf1	婚庆摄影	image_prompt	\N	\N	\N	一张国潮风门店环境图：中式庭院式影楼门面，朱漆大门配铜环，门楣悬“良缘映画”匾额，两侧竹编灯笼与书法卷轴迎宾，台阶青砖铺陈，晨雾微光，电影感色调，横幅构图	\N	f	ai	t	2026-08-09 14:41:52.257	2026-08-09 14:41:52.257
cmslwva0y00dii5hco2irw2gt	婚庆摄影	image_prompt	\N	\N	\N	一张ins风活动海报图：淡粉渐变背景上悬浮手绘气球与胶片边框，中央立体字“520限时档期开放”，下方小字“免定金·赠新娘晨妆体验”，搭配极简线条插画的摄影师&化妆师Q版头像，柔和马卡龙色系	\N	f	ai	t	2026-08-09 14:41:52.258	2026-08-09 14:41:52.258
cmslwva0z00dji5hc5qtjpy9t	婚庆摄影	image_prompt	\N	\N	\N	一张写实风活动海报图：实体影楼橱窗贴纸实拍，高清喷绘含新人剪影、倒计时数字、二维码及门店地址，窗外行人虚化，玻璃反光带出店内布景一角，强信息传达，商业级印刷质感	\N	f	ai	t	2026-08-09 14:41:52.26	2026-08-09 14:41:52.26
cmslwva1000dki5hcn2gut88r	婚庆摄影	image_prompt	\N	\N	\N	一张国潮风活动海报图：宣纸纹理底图上压印烫金篆体“禧”字，四周环绕祥云纹+喜鹊衔枝图案，中央竖排繁体字“端午纳吉·双人礼遇”，右下角盖朱砂印章“已预约”，传统节气×现代婚摄融合	\N	f	ai	t	2026-08-09 14:41:52.261	2026-08-09 14:41:52.261
cmslwva1100dli5hcy60i0gbx	婚庆摄影	image_prompt	\N	\N	\N	一张ins风客户案例图：新人背影牵手站在樱花隧道尽头，裙摆与西装下摆随风轻扬，逆光勾勒发丝金边，浅景深虚化背景，莫兰迪粉白调，情绪感十足，生活化浪漫	\N	f	ai	t	2026-08-09 14:41:52.262	2026-08-09 14:41:52.262
cmslwva1200dmi5hc6o2hcobh	婚庆摄影	image_prompt	\N	\N	\N	一张写实风客户案例图：新人试妆间抓拍瞬间——新娘闭眼由化妆师轻扫高光，摄影师蹲拍侧脸，镜中映出两人专注神情，背景可见散落的头纱与口红试色卡，真实有温度，纪实电影感	\N	f	ai	t	2026-08-09 14:41:52.263	2026-08-09 14:41:52.263
cmslwva1400dni5hcy8axrdeh	婚庆摄影	image_prompt	\N	\N	\N	一张国潮风客户案例图：新人身着改良宋制婚服立于苏州园林月洞门前，女子执团扇半遮面，男子佩玉簪持折扇，背景漏窗透出竹影与红灯笼，青绿山水色调，工笔画质感+摄影实拍结合	\N	f	ai	t	2026-08-09 14:41:52.264	2026-08-09 14:41:52.264
cmslwva1500doi5hckqzk5mut	婚庆摄影	image_prompt	\N	\N	\N	一张ins风氛围图：傍晚天台布景，暖黄串灯垂落，两张藤椅间搭着香槟色纱幔与一小捧洋桔梗，桌上放未拆封的香槟与手写座位卡，空镜构图，温柔静谧，适合配文“我们等你慢慢心动	\N	f	ai	t	2026-08-09 14:41:52.265	2026-08-09 14:41:52.265
cmslwva1600dpi5hc0bd5xg07	婚庆摄影	image_prompt	\N	\N	\N	一张写实风氛围图：婚礼跟拍现场花絮——摄影师半跪调整角度，新人正笑着互喂蛋糕，奶油沾在鼻尖，周围亲友举手机记录，自然抓拍，高动态范围，温暖生活气息	\N	f	ai	t	2026-08-09 14:41:52.266	2026-08-09 14:41:52.266
cmslwva1600dqi5hcyir9340t	婚庆摄影	image_prompt	\N	\N	\N	一张国潮风氛围图：老上海石库门弄堂布景，新人穿旗袍马褂倚红砖墙合影，墙头挂纸鸢与糖葫芦，地面青石板泛微光，梧桐叶飘落，胶片颗粒+复古褪色滤镜，海派摩登×东方韵味	\N	f	ai	t	2026-08-09 14:41:52.267	2026-08-09 14:41:52.267
\.


--
-- Data for Name: content_variants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_variants (id, tenant_id, user_id, content_unit_id, platform, body, title, platform_metadata, content_hash, status, created_at, updated_at, copyright_notice, license_status) FROM stdin;
\.


--
-- Data for Name: content_version_comments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_version_comments (id, version_id, tenant_id, user_id, body, author_name, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: content_versions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_versions (id, draft_id, run_id, tenant_id, user_id, mode, mode_label, title, content, platform, target_type, version_no, status, is_official, source_workflow_id, source_summary, compliance_check_id, compliance_risk_level, compliance_risk_score, compliance_summary, compliance_checked_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: cps_favorites; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cps_favorites (id, tenant_id, user_id, vendor_code, platform_code, item_id, title, image_url, pay_price, coupon_amount, est_rebate, est_net_cost, commission_rate, created_at) FROM stdin;
\.


--
-- Data for Name: cps_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cps_orders (id, tenant_id, user_id, vendor_code, platform_code, order_no, item_id, pay_amount, est_commission, act_commission, user_rebate, platform_share, status, refund_amount, paid_at, settled_at, raw_status, sync_checkpoint, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: cps_platforms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cps_platforms (id, code, name, enabled, "settleDays", created_at) FROM stdin;
\.


--
-- Data for Name: cps_promo_links; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cps_promo_links (id, tenant_id, user_id, vendor_code, platform_code, item_id, original_url, promo_url, idempotency_key, attribution, created_at) FROM stdin;
\.


--
-- Data for Name: cps_vendors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cps_vendors (id, code, name, platform_code, app_key_enc, app_secret_enc, pid, priority, status, created_at) FROM stdin;
\.


--
-- Data for Name: crm_audit_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crm_audit_events (id, owner_id, tenant_id, import_batch_id, event_type, action, status, proof_hash, external_network, external_crm_touched, write_tables, read_tables, summary, payload, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: crm_companies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crm_companies (id, owner_id, name, domain, industry, phone, website, city, employees, annual_revenue_cents, owner_user_id, tags, metadata, archived_at, created_at, updated_at, tenant_id, actor_user_id) FROM stdin;
\.


--
-- Data for Name: crm_customers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crm_customers (id, owner_id, display_name, status, source_platform, source_keyword, matched_keyword, source_url, source_text, latest_reply, score, tags, profile_url, external_user_id, dedupe_key, assigned_user_id, first_interaction_task_id, latest_interaction_task_id, metadata, archived_at, created_at, updated_at, company_id, title, email, phone, wechat, tenant_id, actor_user_id, source_article_id, source_publish_record_id, source_interaction_event_id, source_task_id, source_run_id) FROM stdin;
cmt2sgadz09gy31wmln42wnmp	usr_test_qa	验收测试客户	new	\N	\N	\N	\N	\N	\N	0	[]	\N	\N	crm:700e8c635399908d96040f53128c5b7fc0f54633	\N	\N	\N	{}	\N	2026-08-21 10:10:19.415	2026-08-21 10:10:19.415	\N	\N	\N	13800000001	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa	\N	\N	\N	\N	\N
cmt2ytt3x003i316gr6ko8rpi	usr_test_qa	验收客户B	new	\N	\N	\N	\N	\N	\N	0	[]	\N	\N	crm:feee17d24a89037dc0e0bcc829f6fa2f1ef81f36	\N	\N	\N	{}	\N	2026-08-21 13:08:47.902	2026-08-21 13:08:47.902	\N	\N	\N	13800000002	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa	\N	\N	\N	\N	\N
\.


--
-- Data for Name: crm_import_batches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crm_import_batches (id, owner_id, tenant_id, source_type, filename, status, mode, row_count, committed_count, skipped_count, duplicate_count, warning_count, dry_run_id, dry_run_proof_hash, commit_proof_hash, rollback_token, rollback_proof_hash, rollback_reason, mapping, quality_issues, customer_ids, write_tables, external_network, external_crm_touched, committed_at, rolled_back_at, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: crm_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crm_notes (id, owner_id, body, created_by, company_id, customer_id, opportunity_id, metadata, archived_at, created_at, updated_at, tenant_id, actor_user_id) FROM stdin;
\.


--
-- Data for Name: crm_opportunities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crm_opportunities (id, owner_id, name, stage, amount_cents, currency, probability, company_id, primary_customer_id, close_date, next_step, competitor, source, metadata, archived_at, created_at, updated_at, tenant_id, actor_user_id, lose_reason, win_reason, next_action_at) FROM stdin;
cmt2sgagq09he31wm8bdgylk6	usr_test_qa	验收商机-装修	won	1280000	CNY	20	\N	cmt2sgadz09gy31wmln42wnmp	2026-08-21 00:00:00	\N	\N	\N	{"wonAt": "2026-08-21T10:10:27.573Z", "attribution": {"leadId": null, "sourceRunId": null, "sourceTaskId": null, "wonFromStage": "negotiation", "sourceArticleId": null, "sourcePublishRecordId": null, "sourceInteractionEventId": null}, "wonFromStage": "negotiation"}	\N	2026-08-21 10:10:19.515	2026-08-21 10:10:27.574	cmt2qp30c01mm31wm61euoou6	usr_test_qa	\N	验收测试通过	\N
cmt2ytt5s003y316g15umd3dx	usr_test_qa	验收商机B	won	880000	CNY	20	\N	cmt2ytt3x003i316gr6ko8rpi	2026-08-21 00:00:00	\N	\N	\N	{"wonAt": "2026-08-21T13:08:48.084Z", "attribution": {"leadId": null, "sourceRunId": null, "sourceTaskId": null, "wonFromStage": "negotiation", "sourceArticleId": null, "sourcePublishRecordId": null, "sourceInteractionEventId": null}, "wonFromStage": "negotiation"}	\N	2026-08-21 13:08:47.969	2026-08-21 13:08:48.085	cmt2qp30c01mm31wm61euoou6	usr_test_qa	\N	复验通过	\N
\.


--
-- Data for Name: crm_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crm_tasks (id, owner_id, title, description, status, priority, due_at, completed_at, assignee_id, company_id, customer_id, opportunity_id, metadata, archived_at, created_at, updated_at, tenant_id, actor_user_id) FROM stdin;
\.


--
-- Data for Name: crm_timeline_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crm_timeline_events (id, owner_id, customer_id, related_interaction_task_id, related_runtime_execution_id, event_type, channel, content, reply_content, status, failure_reason, evidence, metadata, created_at, company_id, opportunity_id, task_id, note_id, tenant_id, actor_user_id) FROM stdin;
cmsxyh4e6000ajfqdn9kid4ua	e2e-user-1787014805029	\N	\N	\N	lead_converted	douyin	最近想装修，本地大概多少钱？加个微信聊一下	\N	new	\N	\N	{"leadId": "lead-1787014805029", "sourceUrl": "https://www.douyin.com/video/e2e-12345", "identityId": "cmsxyh4cn0001jfqdq683yj7x", "sourceType": "auto-acquisition", "idempotencyKey": null, "sourceArticleId": null, "sourcePublishRecordId": null, "sourceInteractionEventId": "cmsxyh4ch0000jfqdudrangsz"}	2026-08-18 01:00:05.118	\N	\N	\N	\N	\N	e2e-user-1787014805029
cmsxysf2e000ajfpqdtcsc4hu	e2e-user-1787015332034	\N	\N	\N	lead_converted	douyin	最近想装修，本地大概多少钱？加个微信聊一下	\N	new	\N	\N	{"leadId": "lead-1787015332034", "sourceUrl": "https://www.douyin.com/video/e2e-12345", "identityId": "cmsxysf0e0001jfpqf6nx1fy8", "sourceType": "auto-acquisition", "idempotencyKey": null, "sourceArticleId": null, "sourcePublishRecordId": null, "sourceInteractionEventId": "cmsxysf070000jfpq4kql1bn9"}	2026-08-18 01:08:52.167	\N	\N	\N	\N	\N	e2e-user-1787015332034
cmsxzdqp7000ajfrmfpj9w680	e2e-user-1787016326939	\N	\N	\N	lead_converted	douyin	最近想装修，本地大概多少钱？加个微信聊一下	\N	new	\N	\N	{"leadId": "lead-1787016326939", "sourceUrl": "https://www.douyin.com/video/e2e-12345", "identityId": "cmsxzdqnv0001jfrmrhsbh2e7", "sourceType": "auto-acquisition", "idempotencyKey": null, "sourceArticleId": null, "sourcePublishRecordId": null, "sourceInteractionEventId": "cmsxzdqns0000jfrmtl4ff2en"}	2026-08-18 01:25:27.019	\N	\N	\N	\N	\N	e2e-user-1787016326939
cmt2sgae909h031wm570dgw1u	usr_test_qa	cmt2sgadz09gy31wmln42wnmp	\N	\N	customer_created	manual	创建客户：验收测试客户	\N	new	\N	{}	{"dedupeKey": "crm:700e8c635399908d96040f53128c5b7fc0f54633", "sourceKeyword": null, "matchedKeyword": null}	2026-08-21 10:10:19.425	\N	\N	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
cmt2sgagz09hg31wm67z2djhd	usr_test_qa	\N	\N	\N	opportunity_created	crm	创建商机：验收商机-装修	\N	negotiation	\N	{}	{}	2026-08-21 10:10:19.523	\N	cmt2sgagq09he31wm8bdgylk6	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
cmt2sgglt09i031wmxta170qi	usr_test_qa	cmt2sgadz09gy31wmln42wnmp	\N	\N	opportunity_updated	crm	更新商机：验收商机-装修	\N	negotiation	\N	{}	{"changedFields": ["primaryCustomer"]}	2026-08-21 10:10:27.473	\N	cmt2sgagq09he31wm8bdgylk6	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
cmt2sggoa09ie31wm4w905sqo	usr_test_qa	cmt2sgadz09gy31wmln42wnmp	\N	\N	opportunity_stage_changed	crm	商机阶段变化：negotiation → won	\N	won	\N	{}	{"toStage": "won", "fromStage": "negotiation", "changedFields": ["stage", "winReason", "amountCents", "closeDate"]}	2026-08-21 10:10:27.563	\N	cmt2sgagq09he31wm8bdgylk6	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
cmt2sggor09ig31wm77jbn9xm	usr_test_qa	cmt2sgadz09gy31wmln42wnmp	\N	\N	opportunity_won	crm	商机成交：验收商机-装修，金额 ¥12800.00	\N	won	\N	{}	{"closeDate": "2026-08-21T00:00:00.000Z", "winReason": null, "amountCents": 1280000, "attribution": {"leadId": null, "sourceRunId": null, "sourceTaskId": null, "wonFromStage": "negotiation", "sourceArticleId": null, "sourcePublishRecordId": null, "sourceInteractionEventId": null}}	2026-08-21 10:10:27.579	\N	cmt2sgagq09he31wm8bdgylk6	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
cmt2ytt41003k316g4y5hwpgx	usr_test_qa	cmt2ytt3x003i316gr6ko8rpi	\N	\N	customer_created	manual	创建客户：验收客户B	\N	new	\N	{}	{"dedupeKey": "crm:feee17d24a89037dc0e0bcc829f6fa2f1ef81f36", "sourceKeyword": null, "matchedKeyword": null}	2026-08-21 13:08:47.905	\N	\N	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
cmt2ytt5v0040316g7hl2836i	usr_test_qa	\N	\N	\N	opportunity_created	crm	创建商机：验收商机B	\N	negotiation	\N	{}	{}	2026-08-21 13:08:47.972	\N	cmt2ytt5s003y316g15umd3dx	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
cmt2ytt7c004e316gthpqtm5k	usr_test_qa	cmt2ytt3x003i316gr6ko8rpi	\N	\N	opportunity_updated	crm	更新商机：验收商机B	\N	negotiation	\N	{}	{"changedFields": ["primaryCustomer"]}	2026-08-21 13:08:48.025	\N	cmt2ytt5s003y316g15umd3dx	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
cmt2ytt8u004s316godhv78aq	usr_test_qa	cmt2ytt3x003i316gr6ko8rpi	\N	\N	opportunity_stage_changed	crm	商机阶段变化：negotiation → won	\N	won	\N	{}	{"toStage": "won", "fromStage": "negotiation", "changedFields": ["stage", "winReason", "amountCents", "closeDate"]}	2026-08-21 13:08:48.079	\N	cmt2ytt5s003y316g15umd3dx	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
cmt2ytt94004u316gl0agb232	usr_test_qa	cmt2ytt3x003i316gr6ko8rpi	\N	\N	opportunity_won	crm	商机成交：验收商机B，金额 ¥8800.00	\N	won	\N	{}	{"closeDate": "2026-08-21T00:00:00.000Z", "winReason": null, "amountCents": 880000, "attribution": {"leadId": null, "sourceRunId": null, "sourceTaskId": null, "wonFromStage": "negotiation", "sourceArticleId": null, "sourcePublishRecordId": null, "sourceInteractionEventId": null}}	2026-08-21 13:08:48.088	\N	cmt2ytt5s003y316g15umd3dx	\N	\N	cmt2qp30c01mm31wm61euoou6	usr_test_qa
\.


--
-- Data for Name: default_model_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.default_model_configs (id, purpose, model_id, created_at, updated_at) FROM stdin;
cmsxx1o6k0006jftiqz9d1q5b	article_creation	cmsxx1o6h0005jfti6zsrlzye	2026-08-18 00:20:04.652	2026-08-18 00:20:04.652
cmsxx1o6m0007jfticakuaygv	topic_selection	cmsxx1o6h0005jfti6zsrlzye	2026-08-18 00:20:04.654	2026-08-18 00:20:04.654
\.


--
-- Data for Name: domain_event_outbox; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.domain_event_outbox (id, event_id, schema_version, tenant_id, user_id, aggregate_type, aggregate_id, type, idempotency_key, occurred_at, payload, status, attempt, last_error, consumed_at, created_at) FROM stdin;
cmsxyh4ed000bjfqd627k7ba0	cf85159e7bf9ed51515125033868bf8d275c1f8f	1	legacy-local-desktop	e2e-user-1787014805029	lead	lead-1787014805029	lead.action.executed	convert-crm:lead-1787014805029	2026-08-18 01:00:05.125	{"leadId": "lead-1787014805029", "actionType": "convert_crm", "customerId": "cmsxyh4e30008jfqdqicf2tj2", "identityId": "cmsxyh4cn0001jfqdq683yj7x"}	consumed	0	\N	2026-08-18 01:23:30.01	2026-08-18 01:00:05.125
cmsxysf2m000bjfpq7si2q0mq	5e8ca0e7f1825b1028ef5f4dc969201146353fd6	1	legacy-local-desktop	e2e-user-1787015332034	lead	lead-1787015332034	lead.action.executed	convert-crm:lead-1787015332034	2026-08-18 01:08:52.173	{"leadId": "lead-1787015332034", "actionType": "convert_crm", "customerId": "cmsxysf2c0008jfpq9lg4f9ny", "identityId": "cmsxysf0e0001jfpqf6nx1fy8"}	consumed	0	\N	2026-08-18 01:23:30.014	2026-08-18 01:08:52.174
cmsyzzln4000ijfwitt0l8jzz	cff1bb4947f4cf5ce5f3717d16447d0979435fe0	1	legacy-local-desktop	e2e-user-1787077812623	lead	e2e-lead-1787077812623	lead.action.executed	convert-crm:e2e-lead-1787077812623	2026-08-18 18:30:13.072	{"leadId": "e2e-lead-1787077812623", "taskId": "cmsyzzlmv000fjfwik7aflhh2", "actionType": "convert_crm", "customerId": "cmsyzzlmr000bjfwiz5n8kqs1", "identityId": "cmsyzzlln0003jfwixi6qysjm", "opportunityId": "cmsyzzlmt000djfwibio0sxs2"}	dead	5	\nInvalid `tx.crmTimelineEvent.create()` invocation in\n/Users/yanghy/Documents/New project/ai-content/backend/src/modules/crm/crm.service.ts:5756:32\n\n  5753     metadata?: Prisma.InputJsonObject;\n  5754   },\n  5755 ) {\n→ 5756   return tx.crmTimelineEvent.create(\nForeign key constraint violated on the constraint: `crm_timeline_events_customer_id_fkey`	\N	2026-08-18 18:30:13.073
cmsxzdqpb000bjfrmbqeymbp1	19ec6094586dc6b052d98e4ae8e62e5f1a503f16	1	legacy-local-desktop	e2e-user-1787016326939	lead	lead-1787016326939	lead.action.executed	convert-crm:lead-1787016326939	2026-08-18 01:25:27.023	{"leadId": "lead-1787016326939", "actionType": "convert_crm", "customerId": "cmsxzdqp60008jfrmcs1pn24e", "identityId": "cmsxzdqnv0001jfrmrhsbh2e7"}	dead	5	\nInvalid `tx.crmTimelineEvent.create()` invocation in\n/Users/yanghy/Documents/New project/ai-content/backend/src/modules/crm/crm.service.ts:5756:32\n\n  5753     metadata?: Prisma.InputJsonObject;\n  5754   },\n  5755 ) {\n→ 5756   return tx.crmTimelineEvent.create(\nForeign key constraint violated on the constraint: `crm_timeline_events_customer_id_fkey`	\N	2026-08-18 01:25:27.023
cmsypkwvz000cjf2r9sboe1rv	1d5389a65fc9273a78d50ff2be77c47998def278	1	legacy-local-desktop	e2e-user-1787060331234	lead	e2e-lead-1787060331234	lead.action.executed	convert-crm:e2e-lead-1787060331234	2026-08-18 13:38:51.647	{"leadId": "e2e-lead-1787060331234", "actionType": "convert_crm", "customerId": "cmsypkwvu0009jf2rpc85ck3t", "identityId": "cmsypkwur0002jf2rph6lgtpk"}	dead	5	\nInvalid `tx.crmTimelineEvent.create()` invocation in\n/Users/yanghy/Documents/New project/ai-content/backend/src/modules/crm/crm.service.ts:5756:32\n\n  5753     metadata?: Prisma.InputJsonObject;\n  5754   },\n  5755 ) {\n→ 5756   return tx.crmTimelineEvent.create(\nForeign key constraint violated on the constraint: `crm_timeline_events_customer_id_fkey`	\N	2026-08-18 13:38:51.648
cmsys9gsz000cjff5svn88abp	172e3dbf84ebe62ec1dcb1a7621947c7ecdeb0cf	1	legacy-local-desktop	e2e-user-1787064836354	lead	e2e-lead-1787064836354	lead.action.executed	convert-crm:e2e-lead-1787064836354	2026-08-18 14:53:56.435	{"leadId": "e2e-lead-1787064836354", "actionType": "convert_crm", "customerId": "cmsys9gst0009jff591sbr8cm", "identityId": "cmsys9grw0002jff5vzsq4buf"}	dead	5	\nInvalid `tx.crmTimelineEvent.create()` invocation in\n/Users/yanghy/Documents/New project/ai-content/backend/src/modules/crm/crm.service.ts:5756:32\n\n  5753     metadata?: Prisma.InputJsonObject;\n  5754   },\n  5755 ) {\n→ 5756   return tx.crmTimelineEvent.create(\nForeign key constraint violated on the constraint: `crm_timeline_events_customer_id_fkey`	\N	2026-08-18 14:53:56.436
cmsyta1q4000cjf031rmd8nxi	6865c5bc54ce5cce1c5df03186e1e81caf1d74c0	1	legacy-local-desktop	e2e-user-1787066542970	lead	e2e-lead-1787066542970	lead.action.executed	convert-crm:e2e-lead-1787066542970	2026-08-18 15:22:23.164	{"leadId": "e2e-lead-1787066542970", "actionType": "convert_crm", "customerId": "cmsyta1ps0009jf03d1aalyr0", "identityId": "cmsyta1ns0002jf03tfhio405"}	dead	5	\nInvalid `tx.crmTimelineEvent.create()` invocation in\n/Users/yanghy/Documents/New project/ai-content/backend/src/modules/crm/crm.service.ts:5756:32\n\n  5753     metadata?: Prisma.InputJsonObject;\n  5754   },\n  5755 ) {\n→ 5756   return tx.crmTimelineEvent.create(\nForeign key constraint violated on the constraint: `crm_timeline_events_customer_id_fkey`	\N	2026-08-18 15:22:23.165
cmsyp3gbl000cjf4juwfga11p	20dace5a7b1542a5201fb376845e6e9093083825	1	legacy-local-desktop	e2e-user-1787059516948	lead	e2e-lead-1787059516948	lead.action.executed	convert-crm:e2e-lead-1787059516948	2026-08-18 13:25:17.025	{"leadId": "e2e-lead-1787059516948", "actionType": "convert_crm", "customerId": "cmsyp3gbh0009jf4j5yn7xahj", "identityId": "cmsyp3gak0002jf4jyns2m27z"}	dead	5	\nInvalid `tx.crmTimelineEvent.create()` invocation in\n/Users/yanghy/Documents/New project/ai-content/backend/src/modules/crm/crm.service.ts:5756:32\n\n  5753     metadata?: Prisma.InputJsonObject;\n  5754   },\n  5755 ) {\n→ 5756   return tx.crmTimelineEvent.create(\nForeign key constraint violated on the constraint: `crm_timeline_events_customer_id_fkey`	\N	2026-08-18 13:25:17.026
cmsyykxtf000hjfjwpial29yg	4ddf64b5cc5dca498c894c83546a7cbe1029eb22	1	legacy-local-desktop	e2e-user-1787075449315	lead	e2e-lead-1787075449315	lead.action.executed	convert-crm:e2e-lead-1787075449315	2026-08-18 17:50:49.395	{"leadId": "e2e-lead-1787075449315", "taskId": "cmsyykxta000ejfjw3wj0wa4j", "actionType": "convert_crm", "customerId": "cmsyykxt7000ajfjwut8y4mk4", "identityId": "cmsyykxsk0003jfjwieclyqpn", "opportunityId": "cmsyykxt8000cjfjw9wdfrupt"}	dead	5	\nInvalid `tx.crmTimelineEvent.create()` invocation in\n/Users/yanghy/Documents/New project/ai-content/backend/src/modules/crm/crm.service.ts:5756:32\n\n  5753     metadata?: Prisma.InputJsonObject;\n  5754   },\n  5755 ) {\n→ 5756   return tx.crmTimelineEvent.create(\nForeign key constraint violated on the constraint: `crm_timeline_events_customer_id_fkey`	\N	2026-08-18 17:50:49.395
cmsyz56w9000hjff1bpzseau3	80cfb678f7a24e586e64ce0ecef9c6d7f3a10970	1	legacy-local-desktop	e2e-user-1787076394212	lead	e2e-lead-1787076394212	lead.action.executed	convert-crm:e2e-lead-1787076394212	2026-08-18 18:06:34.281	{"leadId": "e2e-lead-1787076394212", "taskId": "cmsyz56w5000ejff1mr8pq395", "actionType": "convert_crm", "customerId": "cmsyz56w3000ajff1vie2f2lw", "identityId": "cmsyz56vf0003jff19py8p4ds", "opportunityId": "cmsyz56w4000cjff1fv8sq3s1"}	dead	5	\nInvalid `tx.crmTimelineEvent.create()` invocation in\n/Users/yanghy/Documents/New project/ai-content/backend/src/modules/crm/crm.service.ts:5756:32\n\n  5753     metadata?: Prisma.InputJsonObject;\n  5754   },\n  5755 ) {\n→ 5756   return tx.crmTimelineEvent.create(\nForeign key constraint violated on the constraint: `crm_timeline_events_customer_id_fkey`	\N	2026-08-18 18:06:34.282
cmt2sggp009ih31wmta0xbggl	9dafd9e3-5ed6-4d5f-bf79-98414d0a9ebe	1	cmt2qp30c01mm31wm61euoou6	usr_test_qa	crm.opportunity	cmt2sgagq09he31wm8bdgylk6	crm.opportunity.won	opportunity-won:cmt2sgagq09he31wm8bdgylk6	2026-08-21 10:10:27.584	{"name": "验收商机-装修", "leadId": null, "closeDate": "2026-08-21T00:00:00.000Z", "winReason": null, "amountCents": 1280000, "sourceRunId": null, "sourceTaskId": null, "wonFromStage": "negotiation", "opportunityId": "cmt2sgagq09he31wm8bdgylk6", "sourceArticleId": null, "sourcePublishRecordId": null, "sourceInteractionEventId": null}	published	0	\N	\N	2026-08-21 10:10:27.589
cmt2ytt9a004v316gt399d97x	99aacb11-7cc9-4ab1-b4e2-c8d4887f4a97	1	cmt2qp30c01mm31wm61euoou6	usr_test_qa	crm.opportunity	cmt2ytt5s003y316g15umd3dx	crm.opportunity.won	opportunity-won:cmt2ytt5s003y316g15umd3dx	2026-08-21 13:08:48.09	{"name": "验收商机B", "leadId": null, "closeDate": "2026-08-21T00:00:00.000Z", "winReason": null, "amountCents": 880000, "sourceRunId": null, "sourceTaskId": null, "wonFromStage": "negotiation", "opportunityId": "cmt2ytt5s003y316g15umd3dx", "sourceArticleId": null, "sourcePublishRecordId": null, "sourceInteractionEventId": null}	published	0	\N	\N	2026-08-21 13:08:48.094
\.


--
-- Data for Name: entitlement_snapshots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.entitlement_snapshots (id, tenant_id, user_id, plan, "planMode", source, features, blockers, context, ref_id, created_at) FROM stdin;
\.


--
-- Data for Name: executor_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.executor_tasks (id, user_id, device_id, type, payload, status, result, attempts, created_at, updated_at, executed_at) FROM stdin;
\.


--
-- Data for Name: exposure_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.exposure_accounts (id, platform, account_id, name, status, note, created_at, updated_at, user_id) FROM stdin;
\.


--
-- Data for Name: geo_bridge_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.geo_bridge_tasks (id, action_id, action_type, action_title, status, source, brand_id, brand_name, platform, brief, goal, reason, retest_window, return_url, callback_url, keyword, content_preview, result_url, published_url, last_callback_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: growth_account_health; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.growth_account_health (id, user_id, tenant_id, platform, account_id, account_name, login_status, today_action_count, failure_rate, risk_status, cooldown_until, recommendation, last_checked_at) FROM stdin;
douyin:2	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	douyin	2	大壮AI研究员	online	0	0	normal	\N	账号可用于增长任务；仍需遵守每日上限和回读证据。	2026-08-22 02:12:31.814
xiaohongshu:1	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	xiaohongshu	1	蚛	online	0	0	normal	\N	账号可用于增长任务；仍需遵守每日上限和回读证据。	2026-08-22 02:12:31.814
wechat-channel:1	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	wechat-channel	1	视频号验收	online	0	0	normal	\N	请在本机浏览器重新登录 视频号，完成后点击校验状态，再恢复被阻断任务。	2026-08-22 02:12:31.814
douyin:14	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	douyin	14	测试2	online	0	0	normal	\N	账号可用于增长任务；仍需遵守每日上限和回读证据。	2026-08-22 02:12:31.814
douyin:4	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	douyin	4	磊	online	0	0	normal	\N	账号可用于增长任务；仍需遵守每日上限和回读证据。	2026-08-22 02:12:31.814
douyin:6	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	douyin	6	森	online	0	0	normal	\N	账号可用于增长任务；仍需遵守每日上限和回读证据。	2026-08-22 02:12:31.814
douyin:11	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	douyin	11	44	online	0	0	normal	\N	账号可用于增长任务；仍需遵守每日上限和回读证据。	2026-08-22 02:12:31.814
kuaishou:2	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	kuaishou	2	杨宏宇	online	0	0	normal	\N	账号可用于增长任务；仍需遵守每日上限和回读证据。	2026-08-22 02:12:31.814
xiaohongshu:3	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	xiaohongshu	3	杨宏宇	online	0	0	normal	\N	账号可用于增长任务；仍需遵守每日上限和回读证据。	2026-08-22 02:12:31.814
douyin:1	cms2ktllp03u9j1wprksvwy8w	cmt2psn52001gfy4v46brmz1c	douyin	1	施主聒噪	online	0	0	normal	\N	账号可用于增长任务；仍需遵守每日上限和回读证据。	2026-08-22 02:12:31.814
\.


--
-- Data for Name: growth_account_health_snapshots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.growth_account_health_snapshots (id, user_id, tenant_id, platform, account_id, account_name, login_status, today_action_count, failure_rate, risk_status, cooldown_until, recommendation, checked_at) FROM stdin;
\.


--
-- Data for Name: growth_acquisition_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.growth_acquisition_configs (id, user_id, tenant_id, mode, task_name, platform, account_id, account_name, source_inputs, include_keywords, exclude_keywords, blacklist_nicknames, comment_templates, private_message_templates, daily_limit, per_target_limit, deduplicate, schedule_enabled, begin_time, risk_mode, status, exposure_count, exposure_date, last_run_at, created_at, updated_at, actor_user_id) FROM stdin;
\.


--
-- Data for Name: growth_acquisition_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.growth_acquisition_runs (id, user_id, tenant_id, config_id, mode, platform, status, failure_reason, message, candidate_count, selected_count, contacted_count, crm_captured_count, evidence_urls, lead_ids, started_at, ended_at, actor_user_id) FROM stdin;
\.


--
-- Data for Name: growth_leads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.growth_leads (id, user_id, tenant_id, platform, source_type, source_task_id, source_run_id, crm_customer_id, nickname, profile_url, avatar_url, external_user_id, source_text, source_url, video_title, video_url, comment_time, matched_keywords, score, score_reasons, status, next_follow_up_at, owner_user_id, notes, evidence_urls, latest_reply, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: growth_scheduler_leases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.growth_scheduler_leases (id, tenant_id, user_id, owner_id, locked_until, heartbeat_at, last_run_at, cursor, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: growth_strategies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.growth_strategies (id, user_id, tenant_id, industry, scenario, name, source_keywords, demand_keywords, exclude_keywords, blacklist_nicknames, comment_templates, private_message_templates, default_daily_limit, default_risk_mode, scoring_rules, created_at, updated_at, actor_user_id) FROM stdin;
\.


--
-- Data for Name: growth_task_drafts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.growth_task_drafts (id, tenant_id, user_id, actor_user_id, intent, goal, platform, account_id, config_json, planned_actions, missing_fields, readiness, blockers, draft_hash, risk_summary, config_id, status, expires_at, confirmed_at, executed_at, created_at, updated_at) FROM stdin;
cmt3ogv6q000931jkolnf3xqd	legacy-local-desktop	local-user	\N	find_leads	帮我找最近一周对「装修」有需求的抖音用户	douyin	\N	{"mode": "draft-only", "platform": "douyin", "riskMode": "confirm-first"}	[{"risk": "medium", "type": "discover_candidates", "label": "发现抖音目标用户", "requiresConfirmation": true}, {"risk": "low", "type": "enrich_lead", "label": "线索补全与评分", "requiresConfirmation": false}]	["includeKeywords"]	needs-input	[]	1e547d64bf5fcdc1fd5f8cbbaf1e7b1bf996616f3c721c9e2dac0f594a640b9d	\N	\N	draft	2026-08-22 01:36:34.082	\N	\N	2026-08-22 01:06:34.082	2026-08-22 01:06:34.082
cmt3oh7zs000g31jk851m8tk9	legacy-local-desktop	local-user	\N	find_leads	帮我找最近一周对「装修」有需求的抖音用户	douyin	\N	{"mode": "draft-only", "platform": "douyin", "riskMode": "confirm-first"}	[{"risk": "medium", "type": "discover_candidates", "label": "发现抖音目标用户", "requiresConfirmation": true}, {"risk": "low", "type": "enrich_lead", "label": "线索补全与评分", "requiresConfirmation": false}]	["includeKeywords"]	needs-input	[]	1e547d64bf5fcdc1fd5f8cbbaf1e7b1bf996616f3c721c9e2dac0f594a640b9d	\N	\N	draft	2026-08-22 01:36:50.68	\N	\N	2026-08-22 01:06:50.681	2026-08-22 01:06:50.681
cmt3on325000931etjn405hqb	legacy-local-desktop	local-user	local-user	find_leads	帮我找最近一周对「装修」有需求的抖音用户	douyin	\N	{"mode": "draft-only", "platform": "douyin", "riskMode": "confirm-first", "includeKeywords": ["装修"]}	[{"risk": "medium", "type": "discover_candidates", "label": "发现抖音目标用户", "requiresConfirmation": true}, {"risk": "low", "type": "enrich_lead", "label": "线索补全与评分", "requiresConfirmation": false}]	[]	ready	[]	ce7b440e5489459b2c85c5ecf534922e0d73e5dd5814c73b8feb29b541b0400e	意图 find_leads：0 项高风险、1 项中风险动作需确认后执行	\N	confirmed	2026-08-22 01:41:24.22	2026-08-22 01:11:24.302	\N	2026-08-22 01:11:24.221	2026-08-22 01:11:24.302
cmt3p2wps000931rddvop91z8	legacy-local-desktop	local-user	local-user	find_leads	帮我找最近一周对「装修」有需求的抖音用户	douyin	\N	{"mode": "draft-only", "platform": "douyin", "riskMode": "confirm-first", "includeKeywords": ["装修"]}	[{"risk": "medium", "type": "discover_candidates", "label": "发现抖音目标用户", "requiresConfirmation": true}, {"risk": "low", "type": "enrich_lead", "label": "线索补全与评分", "requiresConfirmation": false}]	[]	ready	[]	ce7b440e5489459b2c85c5ecf534922e0d73e5dd5814c73b8feb29b541b0400e	意图 find_leads：0 项高风险、1 项中风险动作需确认后执行	\N	confirmed	2026-08-22 01:53:42.495	2026-08-22 01:23:42.577	\N	2026-08-22 01:23:42.496	2026-08-22 01:23:42.578
\.


--
-- Data for Name: growth_workflows; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.growth_workflows (id, user_id, tenant_id, name, template, status, steps, current_step_id, last_action, last_action_at, created_at, updated_at, industry, scenario) FROM stdin;
\.


--
-- Data for Name: identity_merge_audits; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.identity_merge_audits (id, tenant_id, user_id, target_id, source_id, source_snapshot, migrated_event_ids, migrated_content_ids, field_choices, reverted, reverted_at, created_at) FROM stdin;
\.


--
-- Data for Name: intelligence_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.intelligence_items (id, tenant_id, user_id, source_id, redfox_skill_id, redfox_call_log_id, material_id, topic_id, growth_lead_id, platform, type, title, content, summary, source_url, source_external_id, author, author_url, publish_date, metrics, keywords, raw, status, dedupe_key, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: intelligence_monitors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.intelligence_monitors (id, tenant_id, user_id, skill_install_id, type, platform, keyword, account_external_id, industry, schedule, status, config, cost_limit_points, last_run_at, next_run_at, last_error, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: intelligence_reports; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.intelligence_reports (id, tenant_id, user_id, kind, title, audience, owner, range_key, status, completeness, findings, evidence, markdown, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: interaction_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.interaction_events (id, tenant_id, user_id, platform, account_id, channel, external_event_id, external_thread_id, author_external_id, source_url, source_article_id, publish_record_id, body, dedupe_key, occurred_at, raw, identity_id, content_id, parent_event_id, evidence_url, raw_hash, created_at, updated_at, comment_ref) FROM stdin;
\.


--
-- Data for Name: interaction_task_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.interaction_task_events (id, "taskId", stage, level, message, payload, "createdAt") FROM stdin;
\.


--
-- Data for Name: interaction_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.interaction_tasks (id, "taskType", "accountId", "sessionId", "ruleId", "sendMode", status, "riskLevel", stage, "currentTarget", "draftText", "processedCount", "failedCount", "skippedCount", "batchTargets", "batchSummary", events, evidence, config, "createdBy", "localTaskId", "requiresDoubleConfirmation", "createdAt", "updatedAt", tenant_id, user_id, "claimedBy", "handoffReason", "handoffState", "publishRecordId", "slaDueAt", "sourceArticleId", "sourceUrl") FROM stdin;
\.


--
-- Data for Name: lead_event_outbox; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_event_outbox (id, event_type, payload, status, created_at, consumed_at) FROM stdin;
\.


--
-- Data for Name: lead_score_snapshots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_score_snapshots (id, tenant_id, user_id, lead_id, fit_score, intent_score, identity_confidence, risk_score, total_score, confidence, components, reasons, evidence_ids, model_version, rule_version, scored_at, created_at) FROM stdin;
\.


--
-- Data for Name: lead_signals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_signals (id, tenant_id, user_id, lead_id, type, value, evidence_id, source, observed_at, expires_at, confidence, created_at) FROM stdin;
\.


--
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.leads (id, user_id, tenant_id, platform, source_type, source_account_id, source_task_id, source_run_id, source_article_id, source_publish_record_id, source_interaction_event_id, source_url, source_text, comment_ref, video_title, video_url, comment_time, external_user_id, dedupe_key, nickname, profile_url, avatar_url, score, score_reasons, matched_keywords, signals, latest_reply, reply_persona_id, replied_at, last_error, notes, status, customer_id, evidence_urls, owner_user_id, next_follow_up_at, created_at, updated_at, enrichment_status, identity_confidence, missing_fields) FROM stdin;
\.


--
-- Data for Name: local_engine_agent_confirmations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.local_engine_agent_confirmations (id, session_id, status, risk_level, confirmation_json, created_at, decided_at, action, target, target_label, content, reply_text, operator, note, tenant_id, user_id) FROM stdin;
\.


--
-- Data for Name: local_engine_agent_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.local_engine_agent_sessions (id, source, status, title, session_json, created_at, updated_at, completed_at, scope, target_app, instruction, risk_level, events, confirmations, evidence, tenant_id, user_id) FROM stdin;
\.


--
-- Data for Name: local_engine_reply_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.local_engine_reply_rules (id, rule_json, updated_at, name, industry, tone, send_mode, keywords, forbidden_words, highlights, closing_text, escalation_rules, enabled, tenant_id, user_id, bot_key, config_version, revision, created_at) FROM stdin;
\.


--
-- Data for Name: materials; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.materials (id, title, content, summary, source_url, platform, author, publish_date, collect_date, status, keywords, metadata, created_at, updated_at, mining_count, "hasImage", image_url, original_image_url, owner_id, tenant_id, visibility) FROM stdin;
\.


--
-- Data for Name: mobile_devices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.mobile_devices (id, user_id, device_name, platform, status, last_heartbeat_at, agent_version, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: offer_snapshots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.offer_snapshots (id, vendor_code, platform_code, item_id, title, shop_name, price, coupon_amount, pay_price, commission_rate, est_commission, freight, image_url, raw_json, fetched_at, master_id) FROM stdin;
\.


--
-- Data for Name: platform_identities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.platform_identities (id, tenant_id, user_id, platform, account_id, external_user_id, normalized_handle, nickname, profile_url, avatar_hash, verified, identity_confidence, first_seen_at, last_seen_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: poi_stores; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.poi_stores (id, tenant_id, user_id, name, address, city, category, poi_id, lng, lat, tags, status, note, visit_count, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: price_histories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.price_histories (id, tenant_id, user_id, watch_id, item_id, platform_code, title, price, coupon_amount, pay_price, commission_rate, est_commission, snapshot_at, created_at) FROM stdin;
\.


--
-- Data for Name: price_watches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.price_watches (id, tenant_id, user_id, item_id, platform_code, title, target_pay_price, target_unit_price, min_rebate, notify_windows, status, last_notified_at, created_at, source) FROM stdin;
\.


--
-- Data for Name: procurement_lists; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.procurement_lists (id, tenant_id, user_id, name, address, owner, items, created_at, store_id) FROM stdin;
\.


--
-- Data for Name: product_clip_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.product_clip_configs (id, name, product_name, selling_points, price, audience, duration_seconds, image_url, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: product_masters; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.product_masters (id, name, brand, spec, unit, unit_qty, created_at, title_key) FROM stdin;
\.


--
-- Data for Name: publish_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.publish_accounts (id, platform, name, app_id, api_token, config, created_at, updated_at, tenant_id, user_id, status) FROM stdin;
local-engine-a3d5e9bc6961ed08-1-douyin-38f09c90ef3a	douyin	施主聒噪	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "a4cd1341-48c1-4d32-8f40-9e495ba3fe31.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "施主聒噪", "avatarUrl": "/api/auto-upload/avatars/account_1.png", "avatarPath": "account_1.png", "profileName": "施主聒噪", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T00:21:27.499Z", "engineAccountId": 1, "lastDispatchReason": "browser_session_ready"}	2026-08-10 13:34:23.305	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-4-douyin-38f09c90ef3a	douyin	磊	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "0f00cc96-da77-410e-8f2e-a07e7ec587f3.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "抖音创作者中心", "avatarUrl": "/api/auto-upload/avatars/account_4.png", "avatarPath": "account_4.png", "profileName": "磊", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T00:21:54.501Z", "engineAccountId": 4, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.858	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-2-douyin-38f09c90ef3a	douyin	大壮AI研究员	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "78281faf-51dd-4dd1-aba9-53596ff18336.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "大壮AI研究员", "avatarUrl": "/api/auto-upload/avatars/account_2.png", "avatarPath": "account_2.png", "profileName": "大壮AI研究员", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T00:21:46.959Z", "engineAccountId": 2, "lastDispatchReason": "browser_session_ready"}	2026-08-10 21:12:38.724	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-1-xiaohongshu-38f09c90ef3a	xiaohongshu	蚛	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "a45e0d51-333c-4b38-9e3f-b3c13dc05d36.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "小红书创作服务平台", "avatarUrl": "/api/auto-upload/avatars/account_1.png", "avatarPath": "account_1.png", "profileName": "蚛", "statusLabel": "已登录", "platformType": 1, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-10T21:36:45.528Z", "engineAccountId": 1, "lastDispatchReason": "browser_session_ready"}	2026-08-10 21:16:43.45	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-1-wechat-channel-38f09c90ef3a	wechat-channel	视频号验收	\N	\N	{"source": "local-engine", "status": "expired", "filePath": "81c4bb48-7077-4870-b24f-031b3e2caec4.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "杨宏宇大神", "avatarUrl": "/api/auto-upload/avatars/account_1.png", "avatarPath": "account_1.png", "profileName": "视频号验收", "statusLabel": "需要重新登录", "platformType": 2, "sessionStatus": "needs_login", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": false, "avatarUpdatedAt": "2026-08-12T23:53:01.777Z", "engineAccountId": 1, "lastDispatchReason": "browser_session_needs_login"}	2026-08-10 22:33:04.043	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-6-douyin-38f09c90ef3a	douyin	森	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "6633fece-947c-4fe9-bb95-e988bd469340.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "大壮AI研究员", "avatarUrl": "/api/auto-upload/avatars/account_6.png", "avatarPath": "account_6.png", "profileName": "森", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-19T23:53:34.486Z", "engineAccountId": 6, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.858	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-11-douyin-38f09c90ef3a	douyin	44	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "f4157866-070c-4424-806e-5262ca5380b7.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "施主聒噪", "avatarUrl": "/api/auto-upload/avatars/account_11.png", "avatarPath": "account_11.png", "profileName": "44", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-11T19:27:27.333Z", "engineAccountId": 11, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.858	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-2-kuaishou-38f09c90ef3a	kuaishou	杨宏宇	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "4c639af1-4e80-44ae-893b-e28f2a08299d.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "杨宏宇大神", "avatarUrl": "/api/auto-upload/avatars/account_2.png", "avatarPath": "account_2.png", "profileName": "杨宏宇", "statusLabel": "已登录", "platformType": 4, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T06:36:04.377Z", "engineAccountId": 2, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.858	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-3-xiaohongshu-38f09c90ef3a	xiaohongshu	杨宏宇	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "bc30d270-d886-468b-b4e7-35d8de265b05.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "杨宏宇", "avatarUrl": "/api/auto-upload/avatars/account_3.png", "avatarPath": "account_3.png", "profileName": "杨宏宇", "statusLabel": "已登录", "platformType": 1, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T06:37:06.405Z", "engineAccountId": 3, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.859	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-14-douyin-38f09c90ef3a	douyin	测试2	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "7342df3c-ce0d-4074-aefc-a05b027c663f.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "测试2", "avatarUrl": "/api/auto-upload/avatars/account_14.png", "avatarPath": "account_14.png", "profileName": "测试2", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T14:06:40.206Z", "engineAccountId": 14, "lastDispatchReason": "browser_session_ready"}	2026-08-20 14:06:40.206	2026-08-20 17:52:47.756	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	ready
local-engine-a3d5e9bc6961ed08-1-douyin-586996a462fa	douyin	施主聒噪	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "a4cd1341-48c1-4d32-8f40-9e495ba3fe31.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "施主聒噪", "avatarUrl": "/api/auto-upload/avatars/account_1.png", "avatarPath": "account_1.png", "profileName": "施主聒噪", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T00:21:27.499Z", "engineAccountId": 1, "lastDispatchReason": "browser_session_ready"}	2026-08-10 13:34:23.305	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
local-engine-a3d5e9bc6961ed08-4-douyin-586996a462fa	douyin	磊	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "0f00cc96-da77-410e-8f2e-a07e7ec587f3.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "抖音创作者中心", "avatarUrl": "/api/auto-upload/avatars/account_4.png", "avatarPath": "account_4.png", "profileName": "磊", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T00:21:54.501Z", "engineAccountId": 4, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.858	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
local-engine-a3d5e9bc6961ed08-2-douyin-586996a462fa	douyin	大壮AI研究员	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "78281faf-51dd-4dd1-aba9-53596ff18336.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "大壮AI研究员", "avatarUrl": "/api/auto-upload/avatars/account_2.png", "avatarPath": "account_2.png", "profileName": "大壮AI研究员", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T00:21:46.959Z", "engineAccountId": 2, "lastDispatchReason": "browser_session_ready"}	2026-08-10 21:12:38.724	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
local-engine-a3d5e9bc6961ed08-1-xiaohongshu-586996a462fa	xiaohongshu	蚛	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "a45e0d51-333c-4b38-9e3f-b3c13dc05d36.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "小红书创作服务平台", "avatarUrl": "/api/auto-upload/avatars/account_1.png", "avatarPath": "account_1.png", "profileName": "蚛", "statusLabel": "已登录", "platformType": 1, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-10T21:36:45.528Z", "engineAccountId": 1, "lastDispatchReason": "browser_session_ready"}	2026-08-10 21:16:43.45	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
local-engine-a3d5e9bc6961ed08-1-wechat-channel-586996a462fa	wechat-channel	视频号验收	\N	\N	{"source": "local-engine", "status": "expired", "filePath": "81c4bb48-7077-4870-b24f-031b3e2caec4.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "杨宏宇大神", "avatarUrl": "/api/auto-upload/avatars/account_1.png", "avatarPath": "account_1.png", "profileName": "视频号验收", "statusLabel": "需要重新登录", "platformType": 2, "sessionStatus": "needs_login", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": false, "avatarUpdatedAt": "2026-08-12T23:53:01.777Z", "engineAccountId": 1, "lastDispatchReason": "browser_session_needs_login"}	2026-08-10 22:33:04.043	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
local-engine-a3d5e9bc6961ed08-6-douyin-586996a462fa	douyin	森	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "6633fece-947c-4fe9-bb95-e988bd469340.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "大壮AI研究员", "avatarUrl": "/api/auto-upload/avatars/account_6.png", "avatarPath": "account_6.png", "profileName": "森", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-19T23:53:34.486Z", "engineAccountId": 6, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.858	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
local-engine-a3d5e9bc6961ed08-11-douyin-586996a462fa	douyin	44	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "f4157866-070c-4424-806e-5262ca5380b7.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "施主聒噪", "avatarUrl": "/api/auto-upload/avatars/account_11.png", "avatarPath": "account_11.png", "profileName": "44", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-11T19:27:27.333Z", "engineAccountId": 11, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.858	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
local-engine-a3d5e9bc6961ed08-2-kuaishou-586996a462fa	kuaishou	杨宏宇	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "4c639af1-4e80-44ae-893b-e28f2a08299d.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "杨宏宇大神", "avatarUrl": "/api/auto-upload/avatars/account_2.png", "avatarPath": "account_2.png", "profileName": "杨宏宇", "statusLabel": "已登录", "platformType": 4, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T06:36:04.377Z", "engineAccountId": 2, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.858	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
local-engine-a3d5e9bc6961ed08-3-xiaohongshu-586996a462fa	xiaohongshu	杨宏宇	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "bc30d270-d886-468b-b4e7-35d8de265b05.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "杨宏宇", "avatarUrl": "/api/auto-upload/avatars/account_3.png", "avatarPath": "account_3.png", "profileName": "杨宏宇", "statusLabel": "已登录", "platformType": 1, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T06:37:06.405Z", "engineAccountId": 3, "lastDispatchReason": "browser_session_ready"}	2026-08-20 17:52:41.859	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
local-engine-a3d5e9bc6961ed08-14-douyin-586996a462fa	douyin	测试2	\N	\N	{"source": "local-engine", "status": "ready", "filePath": "7342df3c-ce0d-4074-aefc-a05b027c663f.json", "syncedAt": "2026-08-20T17:52:47.755Z", "userName": "测试2", "avatarUrl": "/api/auto-upload/avatars/account_14.png", "avatarPath": "account_14.png", "profileName": "测试2", "statusLabel": "已登录", "platformType": 3, "sessionStatus": "logged_in", "lastDispatchAt": "2026-08-20T17:52:47.755Z", "lastDispatchOk": true, "avatarUpdatedAt": "2026-08-20T14:06:40.206Z", "engineAccountId": 14, "lastDispatchReason": "browser_session_ready"}	2026-08-20 14:06:40.206	2026-08-20 17:52:47.756	cmt2qp30c01mm31wm61euoou6	usr_test_qa	ready
\.


--
-- Data for Name: publish_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.publish_jobs (id, tenant_id, user_id, variant_id, account_id, status, attempt, scheduled_at, idempotency_key, correlation_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: publish_receipts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.publish_receipts (id, tenant_id, user_id, job_id, external_post_id, external_url, readback_state, readback_at, platform_metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: publish_records; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.publish_records (id, article_id, account_id, platform, status, publish_url, error_message, created_at, updated_at, tenant_id, user_id, durable_record_id, source_identity, body_snapshot, payload_json, result_json, content_version_id, correlation_id, publish_intent_id, readback_state) FROM stdin;
\.


--
-- Data for Name: push_subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.push_subscriptions (id, user_id, tenant_id, endpoint, p256dh, auth, user_agent, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: rebate_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rebate_accounts (id, tenant_id, user_id, available, pending, frozen, total_earned, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: rebate_exchanges; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rebate_exchanges (id, tenant_id, user_id, rebate_amount, rate, credit_amount, status, credit_order_no, idempotency_key, created_at) FROM stdin;
\.


--
-- Data for Name: rebate_ledgers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rebate_ledgers (id, tenant_id, user_id, account_id, biz_type, biz_no, before_amount, change_amount, after_amount, idempotency_key, operator, remark, created_at) FROM stdin;
\.


--
-- Data for Name: rebate_withdrawals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rebate_withdrawals (id, tenant_id, user_id, amount, channel, account_mask, fee, actual_amount, status, external_no, fail_reason, idempotency_key, reviewed_by, paid_at, created_at) FROM stdin;
\.


--
-- Data for Name: redfox_call_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.redfox_call_logs (id, tenant_id, user_id, connection_id, skill_id, skill_code, endpoint, method, status, http_status, cost_points, latency_ms, retry_count, request_hash, request_summary, response_summary, error_code, error_message, started_at, ended_at, created_at) FROM stdin;
\.


--
-- Data for Name: redfox_connections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.redfox_connections (id, tenant_id, user_id, name, api_key_encrypted, api_key_masked, status, daily_call_limit, daily_cost_limit, last_test_at, last_error, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: redfox_interfaces; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.redfox_interfaces (id, platform_code, platform_name, interface_no, code, name, path, method, scenario, status, category, description, price, min_price, require_auth, parameters, examples, raw, synced_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: redfox_skill_installs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.redfox_skill_installs (id, tenant_id, user_id, skill_id, enabled, scenario, config, usage_policy, last_used_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: redfox_skills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.redfox_skills (id, skill_no, code, name, platform, category, tags, summary, description, input_schema, output_schema, status, raw, synced_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: review_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.review_runs (id, tenant_id, user_id, actor_user_id, period, filters, funnel, insights, actions, generated_from, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: risk_policies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.risk_policies (id, action, risk_level, require_confirm, auto_execute, forbidden, min_plan, allowed_roles, whitelist, description, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: rpa_evidence; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rpa_evidence (id, execution_id, step_id, tenant_id, user_id, platform, account_id, kind, uri, sha256, captured_at, page_url, page_fingerprint, source, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: rpa_execution_steps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rpa_execution_steps (id, execution_id, sequence_no, step_name, status, attempt, reason_code, message, result_hash, started_at, ended_at, created_at) FROM stdin;
\.


--
-- Data for Name: rpa_executions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rpa_executions (id, tenant_id, user_id, platform, session_id, account_id, mode, steps, resume_step, input_json, version, reason_code, next_action, page_fingerprint, evidence, status, driver_version, run_id, user_message, technical_message, started_at, ended_at, source) FROM stdin;
\.


--
-- Data for Name: runtime_executions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.runtime_executions (id, "relatedId", "relatedType", executor, platform, "taskType", "accountId", ok, status, "reasonCode", "userMessage", "technicalMessage", "runtimeJson", "evidenceJson", "readbackJson", "agentSSessionId", "engineUrl", "createdAt", tenant_id, user_id, idempotency_key, request_hash, confirmation_id, auth_session_id, claim_token, claimed_at, lease_expires_at, attempt_count, updated_at) FROM stdin;
cmt2psoko003hfy4vrs0viyhf	47	agent-session	local-runtime	快手,抖音,视频号,小红书	auto-upload-publish-record-v1	d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json	f	failed	account_not_logged_in	发布结果：成功 0/4，失败 1，待确认 3	legacy:auto-upload-batch:47	{"tags": [], "title": "4444", "dryRun": false, "legacy": {"storeKey": "47"}, "result": {"summary": {"total": 4, "failed": 0, "blocked": 0, "success": 0, "loginRequired": 0, "materialError": 0, "notIntegrated": 0, "pendingManual": 3, "accountExpired": 1}, "platforms": [{"status": "account_expired", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请重新登录该平台账号", "failureReason": "快手账号「失主聒噪」登录态失效"}, {"status": "pending_manual", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "47"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "48"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "49"}]}, "source": "durable_publish_record", "version": 1, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "payloads": [{"tags": [], "type": 3, "title": "4444", "biliType": "自制", "category": 0, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "biliTitle": "4444", "startDays": 0, "accountIds": [1], "dailyTimes": ["10:00"], "accountList": ["83412474-5e06-11f1-a807-7e803b9a8d04.json"], "contentKind": "video", "debugDryRun": false, "enableTimer": 0, "videosPerDay": 1, "timeJitterMinutes": 0, "debugDryRunHoldBrowser": false}], "createdAt": "2026-06-04T11:30:20.172Z", "updatedAt": "2026-06-04T11:30:20.172Z", "accountFile": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json、83412474-5e06-11f1-a807-7e803b9a8d04.json、8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json、aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "platformType": 3, "engineTaskIds": ["47", "48", "49"]}	[{"status": "account_expired", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json"}, {"status": "pending_manual", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "47"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "48"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "49"}]	{"verified": false, "platforms": [{"matched": false, "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json"}, {"matched": false, "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "47"}, {"matched": false, "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "48"}, {"matched": false, "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "49"}]}	\N	internal://auto-upload/publish-records	2026-06-04 11:30:20.172	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	\N	\N	\N	\N	\N	\N	\N	0	2026-08-21 08:55:58.825
cmt2psokw003ify4vcj0uujnp	48	agent-session	local-runtime	快手,抖音,视频号,小红书	auto-upload-publish-record-v1	d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json	f	failed	account_not_logged_in	发布结果：成功 0/4，失败 1，待确认 3	legacy:auto-upload-batch:48	{"tags": [], "title": "4444", "dryRun": false, "legacy": {"storeKey": "48"}, "result": {"summary": {"total": 4, "failed": 0, "blocked": 0, "success": 0, "loginRequired": 0, "materialError": 0, "notIntegrated": 0, "pendingManual": 3, "accountExpired": 1}, "platforms": [{"status": "account_expired", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请重新登录该平台账号", "failureReason": "快手账号「失主聒噪」登录态失效"}, {"status": "pending_manual", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "47"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "48"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "49"}]}, "source": "durable_publish_record", "version": 1, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "payloads": [{"tags": [], "type": 2, "title": "4444", "biliType": "自制", "category": 0, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "biliTitle": "4444", "startDays": 0, "accountIds": [4], "dailyTimes": ["10:00"], "accountList": ["8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json"], "contentKind": "video", "debugDryRun": false, "enableTimer": 0, "videosPerDay": 1, "timeJitterMinutes": 0, "debugDryRunHoldBrowser": false}], "createdAt": "2026-06-04T11:30:20.172Z", "updatedAt": "2026-06-04T11:30:20.172Z", "accountFile": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json、83412474-5e06-11f1-a807-7e803b9a8d04.json、8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json、aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "platformType": 2, "engineTaskIds": ["47", "48", "49"]}	[{"status": "account_expired", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json"}, {"status": "pending_manual", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "47"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "48"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "49"}]	{"verified": false, "platforms": [{"matched": false, "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json"}, {"matched": false, "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "47"}, {"matched": false, "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "48"}, {"matched": false, "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "49"}]}	\N	internal://auto-upload/publish-records	2026-06-04 11:30:20.172	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	\N	\N	\N	\N	\N	\N	\N	0	2026-08-21 08:55:58.833
cmt2psol2003jfy4vcmhvalef	49	agent-session	local-runtime	快手,抖音,视频号,小红书	auto-upload-publish-record-v1	d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json	f	failed	account_not_logged_in	发布结果：成功 0/4，失败 1，待确认 3	legacy:auto-upload-batch:49	{"tags": [], "title": "4444", "dryRun": false, "legacy": {"storeKey": "49"}, "result": {"summary": {"total": 4, "failed": 0, "blocked": 0, "success": 0, "loginRequired": 0, "materialError": 0, "notIntegrated": 0, "pendingManual": 3, "accountExpired": 1}, "platforms": [{"status": "account_expired", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请重新登录该平台账号", "failureReason": "快手账号「失主聒噪」登录态失效"}, {"status": "pending_manual", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "47"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "48"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "49"}]}, "source": "durable_publish_record", "version": 1, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "payloads": [{"tags": [], "type": 1, "title": "4444", "biliType": "自制", "category": 0, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "biliTitle": "4444", "startDays": 0, "accountIds": [2], "dailyTimes": ["10:00"], "accountList": ["aa040e74-5e05-11f1-811e-7e803b9a8d04.json"], "contentKind": "video", "debugDryRun": false, "enableTimer": 0, "videosPerDay": 1, "timeJitterMinutes": 0, "debugDryRunHoldBrowser": false}], "createdAt": "2026-06-04T11:30:20.172Z", "updatedAt": "2026-06-04T11:30:20.172Z", "accountFile": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json、83412474-5e06-11f1-a807-7e803b9a8d04.json、8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json、aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "platformType": 1, "engineTaskIds": ["47", "48", "49"]}	[{"status": "account_expired", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json"}, {"status": "pending_manual", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "47"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "48"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "49"}]	{"verified": false, "platforms": [{"matched": false, "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json"}, {"matched": false, "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "47"}, {"matched": false, "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "48"}, {"matched": false, "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "49"}]}	\N	internal://auto-upload/publish-records	2026-06-04 11:30:20.172	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	\N	\N	\N	\N	\N	\N	\N	0	2026-08-21 08:55:58.839
cmt2psol7003kfy4vnsplfe93	54	agent-session	local-runtime	抖音,视频号,小红书,快手	auto-upload-publish-record-v1	83412474-5e06-11f1-a807-7e803b9a8d04.json	f	failed	send_failed	发布结果：成功 0/4，失败 1，待确认 3	legacy:auto-upload-batch:54	{"tags": [], "title": "圭", "dryRun": false, "legacy": {"storeKey": "54"}, "result": {"summary": {"total": 4, "failed": 1, "blocked": 0, "success": 0, "loginRequired": 0, "materialError": 0, "notIntegrated": 0, "pendingManual": 3, "accountExpired": 0}, "platforms": [{"status": "failed", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "nextAction": "请检查发布参数后重试", "failureReason": "Locator.set_input_files: Timeout 30000ms exceeded.\\nCall log:\\n  - waiting for locator(\\"div[class^='upload-card'] input[type=file]\\")\\n    2 × waiting for\\" https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page\\" navigation to finish...\\n    - navigated to \\"https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page\\"\\n", "publishTaskId": "54"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "55"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "56"}, {"status": "pending_manual", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "57"}]}, "source": "durable_publish_record", "version": 1, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "payloads": [{"tags": [], "type": 3, "title": "圭", "biliType": "自制", "category": 0, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "biliTitle": "圭", "startDays": 0, "accountIds": [1], "dailyTimes": ["10:00"], "accountList": ["83412474-5e06-11f1-a807-7e803b9a8d04.json"], "contentKind": "video", "debugDryRun": false, "enableTimer": 0, "videosPerDay": 1, "timeJitterMinutes": 0, "debugDryRunHoldBrowser": false}], "createdAt": "2026-06-04T11:31:03.895Z", "updatedAt": "2026-06-04T11:31:03.895Z", "accountFile": "83412474-5e06-11f1-a807-7e803b9a8d04.json、8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json、aa040e74-5e05-11f1-811e-7e803b9a8d04.json、d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "platformType": 3, "engineTaskIds": ["54", "55", "56", "57"]}	[{"status": "failed", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "54"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "55"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "56"}, {"status": "pending_manual", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "57"}]	{"verified": false, "platforms": [{"matched": false, "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "54"}, {"matched": false, "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "55"}, {"matched": false, "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "56"}, {"matched": false, "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "57"}]}	\N	internal://auto-upload/publish-records	2026-06-04 11:31:03.895	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	\N	\N	\N	\N	\N	\N	\N	0	2026-08-21 08:55:58.843
cmt2psold003lfy4vuv7wbvs1	55	agent-session	local-runtime	抖音,视频号,小红书,快手	auto-upload-publish-record-v1	83412474-5e06-11f1-a807-7e803b9a8d04.json	f	failed	send_failed	发布结果：成功 0/4，失败 1，待确认 3	legacy:auto-upload-batch:55	{"tags": [], "title": "圭", "dryRun": false, "legacy": {"storeKey": "55"}, "result": {"summary": {"total": 4, "failed": 1, "blocked": 0, "success": 0, "loginRequired": 0, "materialError": 0, "notIntegrated": 0, "pendingManual": 3, "accountExpired": 0}, "platforms": [{"status": "failed", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "nextAction": "请检查发布参数后重试", "failureReason": "Locator.set_input_files: Timeout 30000ms exceeded.\\nCall log:\\n  - waiting for locator(\\"div[class^='upload-card'] input[type=file]\\")\\n    2 × waiting for\\" https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page\\" navigation to finish...\\n    - navigated to \\"https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page\\"\\n", "publishTaskId": "54"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "55"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "56"}, {"status": "pending_manual", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "57"}]}, "source": "durable_publish_record", "version": 1, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "payloads": [{"tags": [], "type": 2, "title": "圭", "biliType": "自制", "category": 0, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "biliTitle": "圭", "startDays": 0, "accountIds": [4], "dailyTimes": ["10:00"], "accountList": ["8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json"], "contentKind": "video", "debugDryRun": false, "enableTimer": 0, "videosPerDay": 1, "timeJitterMinutes": 0, "debugDryRunHoldBrowser": false}], "createdAt": "2026-06-04T11:31:03.895Z", "updatedAt": "2026-06-04T11:31:03.895Z", "accountFile": "83412474-5e06-11f1-a807-7e803b9a8d04.json、8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json、aa040e74-5e05-11f1-811e-7e803b9a8d04.json、d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "platformType": 2, "engineTaskIds": ["54", "55", "56", "57"]}	[{"status": "failed", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "54"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "55"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "56"}, {"status": "pending_manual", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "57"}]	{"verified": false, "platforms": [{"matched": false, "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "54"}, {"matched": false, "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "55"}, {"matched": false, "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "56"}, {"matched": false, "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "57"}]}	\N	internal://auto-upload/publish-records	2026-06-04 11:31:03.895	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	\N	\N	\N	\N	\N	\N	\N	0	2026-08-21 08:55:58.85
cmt2psolk003mfy4vso0kgg0z	56	agent-session	local-runtime	抖音,视频号,小红书,快手	auto-upload-publish-record-v1	83412474-5e06-11f1-a807-7e803b9a8d04.json	f	failed	send_failed	发布结果：成功 0/4，失败 1，待确认 3	legacy:auto-upload-batch:56	{"tags": [], "title": "圭", "dryRun": false, "legacy": {"storeKey": "56"}, "result": {"summary": {"total": 4, "failed": 1, "blocked": 0, "success": 0, "loginRequired": 0, "materialError": 0, "notIntegrated": 0, "pendingManual": 3, "accountExpired": 0}, "platforms": [{"status": "failed", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "nextAction": "请检查发布参数后重试", "failureReason": "Locator.set_input_files: Timeout 30000ms exceeded.\\nCall log:\\n  - waiting for locator(\\"div[class^='upload-card'] input[type=file]\\")\\n    2 × waiting for\\" https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page\\" navigation to finish...\\n    - navigated to \\"https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page\\"\\n", "publishTaskId": "54"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "55"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "56"}, {"status": "pending_manual", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "57"}]}, "source": "durable_publish_record", "version": 1, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "payloads": [{"tags": [], "type": 1, "title": "圭", "biliType": "自制", "category": 0, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "biliTitle": "圭", "startDays": 0, "accountIds": [2], "dailyTimes": ["10:00"], "accountList": ["aa040e74-5e05-11f1-811e-7e803b9a8d04.json"], "contentKind": "video", "debugDryRun": false, "enableTimer": 0, "videosPerDay": 1, "timeJitterMinutes": 0, "debugDryRunHoldBrowser": false}], "createdAt": "2026-06-04T11:31:03.895Z", "updatedAt": "2026-06-04T11:31:03.895Z", "accountFile": "83412474-5e06-11f1-a807-7e803b9a8d04.json、8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json、aa040e74-5e05-11f1-811e-7e803b9a8d04.json、d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "platformType": 1, "engineTaskIds": ["54", "55", "56", "57"]}	[{"status": "failed", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "54"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "55"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "56"}, {"status": "pending_manual", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "57"}]	{"verified": false, "platforms": [{"matched": false, "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "54"}, {"matched": false, "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "55"}, {"matched": false, "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "56"}, {"matched": false, "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "57"}]}	\N	internal://auto-upload/publish-records	2026-06-04 11:31:03.895	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	\N	\N	\N	\N	\N	\N	\N	0	2026-08-21 08:55:58.856
cmt2psolp003nfy4vhiy4c0gf	57	agent-session	local-runtime	抖音,视频号,小红书,快手	auto-upload-publish-record-v1	83412474-5e06-11f1-a807-7e803b9a8d04.json	f	failed	send_failed	发布结果：成功 0/4，失败 1，待确认 3	legacy:auto-upload-batch:57	{"tags": [], "title": "圭", "dryRun": false, "legacy": {"storeKey": "57"}, "result": {"summary": {"total": 4, "failed": 1, "blocked": 0, "success": 0, "loginRequired": 0, "materialError": 0, "notIntegrated": 0, "pendingManual": 3, "accountExpired": 0}, "platforms": [{"status": "failed", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "nextAction": "请检查发布参数后重试", "failureReason": "Locator.set_input_files: Timeout 30000ms exceeded.\\nCall log:\\n  - waiting for locator(\\"div[class^='upload-card'] input[type=file]\\")\\n    2 × waiting for\\" https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page\\" navigation to finish...\\n    - navigated to \\"https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page\\"\\n", "publishTaskId": "54"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "55"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "56"}, {"status": "pending_manual", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "57"}]}, "source": "durable_publish_record", "version": 1, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "payloads": [{"tags": [], "type": 4, "title": "圭", "biliType": "自制", "category": 0, "fileList": ["0264cc64-5a39-11f1-84ca-7e803b9a8d04_椰蛮人-视频素材-05.mp4"], "biliTitle": "圭", "startDays": 0, "accountIds": [3], "dailyTimes": ["10:00"], "accountList": ["d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json"], "contentKind": "video", "debugDryRun": false, "enableTimer": 0, "videosPerDay": 1, "timeJitterMinutes": 0, "debugDryRunHoldBrowser": false}], "createdAt": "2026-06-04T11:31:03.895Z", "updatedAt": "2026-06-04T11:31:03.895Z", "accountFile": "83412474-5e06-11f1-a807-7e803b9a8d04.json、8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json、aa040e74-5e05-11f1-811e-7e803b9a8d04.json、d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "platformType": 4, "engineTaskIds": ["54", "55", "56", "57"]}	[{"status": "failed", "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "54"}, {"status": "pending_manual", "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "55"}, {"status": "pending_manual", "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "56"}, {"status": "pending_manual", "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "57"}]	{"verified": false, "platforms": [{"matched": false, "platform": "抖音", "accountId": "83412474-5e06-11f1-a807-7e803b9a8d04.json", "publishTaskId": "54"}, {"matched": false, "platform": "视频号", "accountId": "8f576ae0-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "55"}, {"matched": false, "platform": "小红书", "accountId": "aa040e74-5e05-11f1-811e-7e803b9a8d04.json", "publishTaskId": "56"}, {"matched": false, "platform": "快手", "accountId": "d0153e7c-5ffd-11f1-8749-7e803b9a8d04.json", "publishTaskId": "57"}]}	\N	internal://auto-upload/publish-records	2026-06-04 11:31:03.895	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	\N	\N	\N	\N	\N	\N	\N	0	2026-08-21 08:55:58.861
cmt2psolu003ofy4vyt9wx5s1	101	agent-session	local-runtime	B站	auto-upload-publish-record-v1	/accounts/bili.json	f	waiting	readback_failed	发布结果：成功 0/1，失败 0，待确认 1	legacy:auto-upload-batch:101	{"tags": [], "title": "B站发布", "dryRun": false, "legacy": {"storeKey": "101"}, "result": {"summary": {"total": 1, "failed": 0, "blocked": 0, "success": 0, "loginRequired": 0, "materialError": 0, "notIntegrated": 0, "pendingManual": 1, "accountExpired": 0}, "platforms": [{"status": "pending_manual", "platform": "B站", "accountId": "/accounts/bili.json", "nextAction": "请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。", "failureReason": "本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。", "publishTaskId": "101"}], "recordedAt": "2026-07-09T22:49:00.670Z"}, "source": "durable_publish_record", "version": 1, "fileList": [], "payloads": [], "createdAt": "2026-07-09T22:49:00.670Z", "updatedAt": "2026-07-09T22:49:00.670Z", "accountFile": "/accounts/bili.json", "platformType": 0, "engineTaskIds": ["101"]}	[{"status": "pending_manual", "platform": "B站", "accountId": "/accounts/bili.json", "publishTaskId": "101"}]	{"verified": false, "platforms": [{"matched": false, "platform": "B站", "accountId": "/accounts/bili.json", "publishTaskId": "101"}]}	\N	internal://auto-upload/publish-records	2026-07-09 22:49:00.67	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	\N	\N	\N	\N	\N	\N	\N	0	2026-08-21 08:55:58.866
\.


--
-- Data for Name: savings_checkins; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.savings_checkins (id, tenant_id, user_id, checkin_date, reward_amount, streak_day, created_at) FROM stdin;
\.


--
-- Data for Name: schedule_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schedule_configs (id, task_type, cron_expr, enabled, config, last_run_time, created_at, updated_at, user_id) FROM stdin;
cmsxwgz7g0000jfubdgnek4ae	collect_materials	0 * * * *	f	\N	\N	2026-08-18 00:03:59.164	2026-08-18 00:03:59.164	legacy-local-user
cmsxwgz7p0001jfubdz4q5d2y	mine_materials	30 * * * *	f	\N	\N	2026-08-18 00:03:59.174	2026-08-18 00:03:59.174	legacy-local-user
cmsxwgz7t0002jfubhh7ip29p	create_articles	0 0 * * *	f	\N	\N	2026-08-18 00:03:59.178	2026-08-18 00:03:59.178	legacy-local-user
\.


--
-- Data for Name: showcase_authorizations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_authorizations (id, case_id, record_type, grantor, scope, license_name, source_url, version_or_commit, attachment, valid_from, valid_until, review_status, reviewer_user_id, restriction_notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: showcase_case_reviews; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_case_reviews (id, case_id, review_type, submitted_by, reviewed_by, decision, comments, changed_fields, created_at) FROM stdin;
\.


--
-- Data for Name: showcase_cases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_cases (id, slug, title, subtitle, provenance_type, client_visibility, primary_platform, platforms, primary_industry, industries, capability_tags, business_problem, solution_summary, key_features, results_summary, evidence_level, evidence_scope, delivery_modes, maturity, tech_summary, cover_media, seo_title, seo_description, status, published_at, last_reviewed_at, next_review_at, owner_user_id, reviewer_user_id, created_at, updated_at) FROM stdin;
cmsz1vitx000hjfb8dmgjtbf4	retail-private-domain-growth	连锁零售私域增长案例	把门店会员沉淀到私域，用 AI 内容持续激活复购	delivery	public	wechat	{wechat,wechat_mini_program}	retail	{retail}	{private_domain,lead_gen}	某连锁零售品牌门店客流下滑，会员分散在 POS 与公众号，缺乏统一的私域触达与复购抓手，营销活动转化率持续走低。	统一会员数据接入企业微信私域，搭建分层运营 SOP，用 AI 批量生产朋友圈 / 社群 / 1v1 触达内容，按会员生命周期自动推送。	[{"title": "会员数据统一", "description": "打通 POS、公众号与企业微信，形成统一会员视图"}, {"title": "AI 内容批量生产", "description": "按人群与场景批量生成合规营销文案"}, {"title": "自动化触达", "description": "基于生命周期与行为自动推送，减少人工跟进"}]	试点门店 3 个月复购率提升 18%，社群活跃度提升 40%。	E2	客户经营数据脱敏回访	{h5,wechat_mini_program}	scale	企业微信 + 小程序 + AI 内容引擎	\N	连锁零售私域增长案例 - 九章智能	连锁零售品牌私域会员运营与 AI 内容自动化触达交付案例。	published	2026-08-15 19:23:02.035	\N	\N	\N	\N	2026-08-18 19:23:02.037	2026-08-18 19:23:02.037
cmsz1viu1000ijfb86tzwwh6w	cross-border-content-lead-gen	跨境电商内容获客案例	AI 多语种内容矩阵，降低跨境获客成本	delivery	public	xiaohongshu	{douyin,xiaohongshu}	saas	{retail,saas}	{ai_content_generation,lead_gen}	跨境电商 SaaS 厂商缺乏本地化内容生产能力，海外社媒账号长期低活跃，线索获取高度依赖付费广告，成本高企。	搭建 AI 多语种内容生产流水线，围绕目标市场热点自动选题、生成与分发，配合落地页与线索表单完成获客闭环。	[{"title": "多语种内容生成", "description": "一键生成英 / 日 / 西等多语种营销内容"}, {"title": "热点选题", "description": "自动抓取目标市场趋势并生成选题建议"}, {"title": "线索归因", "description": "从内容点击到表单提交的完整归因链"}]	内容线索占比从 12% 提升至 45%，获客成本下降 30%。	E1	客户投放与线索数据回访	{web}	product	AI 内容流水线 + 多语言模型	\N	跨境电商内容获客案例 - 九章智能	跨境电商 SaaS 多语种内容矩阵与线索获客交付案例。	published	2026-08-08 19:23:02.04	\N	\N	\N	\N	2026-08-18 19:23:02.041	2026-08-18 19:23:02.041
cmsz1viu3000jjfb8jl4zog9g	open-source-customer-support-bot	开源智能客服助手	基于开源大模型的轻量客服机器人	open_source	public	web	{web}	saas	{saas}	{chatbot}	中小团队希望拥有可私有部署的智能客服，但商业方案成本高、数据合规顾虑大。	基于开源大模型与检索增强（RAG）搭建可私有部署的客服助手，支持知识库问答与人工转接。	[{"title": "可私有部署", "description": "数据不出域，满足合规要求"}, {"title": "RAG 知识库", "description": "基于本地文档的检索增强问答"}, {"title": "人工转接", "description": "低置信回答自动转人工"}]	开源社区演示环境可回答常见产品问题，支持一键部署。	E1	开源项目文档与演示环境	{web,download}	mvp	开源大模型 + 向量检索 + RAG	\N	开源智能客服助手 - 九章智能	基于开源大模型的可私有部署智能客服助手演示。	published	2026-08-03 19:23:02.042	\N	\N	\N	\N	2026-08-18 19:23:02.043	2026-08-18 19:23:02.043
cmsz1viu5000kjfb809a7a0w2	open-source-content-workbench	开源内容生成工作台	开箱即用的 AI 文案与配图工作台	open_source	public	web	{web}	saas	{saas}	{ai_content_generation}	运营人员需要快速产出多平台文案与配图，但现成工具要么付费、要么无法自定义工作流。	开源一个可扩展的 AI 内容工作台，内置多平台文案模板与配图生成，支持自定义 prompt 与工作流。	[{"title": "多平台模板", "description": "内置公众号 / 小红书 / 抖音文案模板"}, {"title": "自定义工作流", "description": "可视化编排 prompt 与输出节点"}, {"title": "本地运行", "description": "支持本地模型或外部 API 两种模式"}]	开发者可 fork 后二次开发，社区贡献多个行业模板。	E0	\N	{download}	prototype	Next.js + 开源模型	\N	开源内容生成工作台 - 九章智能	开源 AI 文案与配图生成工作台演示。	published	2026-07-29 19:23:02.044	\N	\N	\N	\N	2026-08-18 19:23:02.045	2026-08-18 19:23:02.045
cmsz1viu9000ljfb8sakuoluo	ai-live-selection-prototype	AI 直播选品概念原型	用数据帮主播更快选出好卖的品	prototype	public	douyin	{douyin}	fmcg	{fmcg}	{data_analysis,ai_content_generation}	直播选品依赖主播经验，缺乏数据支撑，容易押错品造成库存压力。	聚合直播带货数据，用 AI 生成选品建议与话术要点，辅助主播决策。	[{"title": "选品打分", "description": "按销量、毛利、热度等维度打分排序"}, {"title": "话术生成", "description": "针对选定商品自动生成直播话术"}, {"title": "库存预警", "description": "结合动销预测给出库存建议"}]	概念原型演示，界面与数据均为演示数据。	E0	\N	{h5}	concept	数据分析 + AI 生成（概念原型）	\N	AI 直播选品概念原型 - 九章智能	AI 直播选品辅助决策概念原型演示。	published	2026-08-13 19:23:02.049	\N	\N	\N	\N	2026-08-18 19:23:02.05	2026-08-18 19:23:02.05
cmsz1viub000mjfb8pyqqdd2g	smart-store-inspection-prototype	智能门店巡检原型	AI 识别门店陈列与卫生问题	prototype	public	app	{app}	retail	{retail}	{automation,data_analysis}	门店巡检依赖人工拍照上报，问题识别滞后，整改闭环难以追踪。	用视觉 AI 自动识别门店陈列、缺货与卫生问题，生成整改工单并跟踪闭环。	[{"title": "视觉识别", "description": "自动识别缺货、陈列与卫生问题"}, {"title": "工单闭环", "description": "问题自动生成工单并跟踪整改"}, {"title": "巡检报表", "description": "自动汇总门店合规率与趋势"}]	概念原型演示，界面与数据均为演示数据。	E0	\N	{app}	concept	视觉 AI + 工单（概念原型）	\N	智能门店巡检原型 - 九章智能	AI 门店陈列与卫生巡检概念原型演示。	published	2026-08-10 19:23:02.051	\N	\N	\N	\N	2026-08-18 19:23:02.052	2026-08-18 19:23:02.052
cmsz1viud000njfb8qmi4x1ps	wechat-account-operation-template	公众号运营模板	教育机构可复用的公众号内容运营模板	template	public	wechat	{wechat}	education	{education}	{ai_content_generation}	教育机构想做公众号内容但缺乏持续产出能力与选题规划。	提供可复用的公众号内容运营模板：选题日历、AI 文案模板与发布 SOP。	[{"title": "选题日历", "description": "按招生节奏预设整月选题"}, {"title": "AI 文案模板", "description": "一键套用行业模板生成文章"}, {"title": "发布 SOP", "description": "排版、发布与数据复盘全流程"}]	模板演示，界面与数据均为演示数据。	E0	\N	{web}	template	模板 + AI 生成（可定制）	\N	公众号运营模板 - 九章智能	教育机构公众号内容运营可定制模板演示。	published	2026-08-06 19:23:02.052	\N	\N	\N	\N	2026-08-18 19:23:02.053	2026-08-18 19:23:02.053
cmsz1viuf000ojfb8hoa7h29y	private-domain-sop-template	私域社群 SOP 模板	医疗健康行业可复用的私域社群运营模板	template	public	wechat	{wechat}	healthcare	{healthcare}	{private_domain,automation}	医疗健康机构私域运营缺乏标准化流程，社群活跃度与转化难以稳定。	提供私域社群 SOP 模板：入群欢迎、内容节奏、活动与转化话术自动化配置。	[{"title": "社群 SOP", "description": "入群到转化的全流程标准话术"}, {"title": "自动化配置", "description": "按时间轴自动推送内容"}, {"title": "合规模板", "description": "内置医疗健康行业合规话术"}]	模板演示，界面与数据均为演示数据。	E0	\N	{web}	template	模板 + 自动化（可定制）	\N	私域社群 SOP 模板 - 九章智能	医疗健康行业私域社群运营可定制模板演示。	published	2026-07-31 19:23:02.054	\N	\N	\N	\N	2026-08-18 19:23:02.055	2026-08-18 19:23:02.055
\.


--
-- Data for Name: showcase_collection_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_collection_items (collection_id, case_id, sort_order) FROM stdin;
\.


--
-- Data for Name: showcase_collections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_collections (id, slug, title, description, cover_media, visibility, channel_code, internal_customer_alias, valid_until, owner_user_id, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: showcase_demo_endpoints; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_demo_endpoints (id, case_id, endpoint_type, target_url, short_code, allowed_devices, iframe_allowed, access_instruction, valid_from, valid_until, fallback_type, fallback_target, health_status, last_checked_at, owner_user_id, created_at, updated_at) FROM stdin;
cmsz1viuk000qjfb8wl6k695p	cmsz1vitx000hjfb8dmgjtbf4	web	https://demo.internal.example.com	\N	{desktop,mobile}	t	演示环境，数据为演示数据	\N	\N	media	\N	healthy	\N	\N	2026-08-18 19:23:02.06	2026-08-18 19:23:02.06
cmsz1viuo000sjfb8viqwrtw0	cmsz1viu3000jjfb8jl4zog9g	web	https://demo.internal.example.com	\N	{desktop,mobile}	t	演示环境，数据为演示数据	\N	\N	media	\N	healthy	\N	\N	2026-08-18 19:23:02.064	2026-08-18 19:23:02.064
\.


--
-- Data for Name: showcase_media; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_media (id, case_id, media_type, file_url, external_url, thumbnail_url, title, caption, alt_text, device_frame, sort_order, rights_status, sensitive_reviewed, checksum, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: showcase_short_links; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_short_links (id, short_code, target_type, target_id, target_url, status, valid_until, channel_code, open_count, last_open_at, owner_user_id, case_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: showcase_tag_aliases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_tag_aliases (id, alias, canonical_taxonomy_id, created_at) FROM stdin;
\.


--
-- Data for Name: showcase_taxonomies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.showcase_taxonomies (id, type, slug, name, sort_order, enabled, created_at, updated_at) FROM stdin;
cmsz1vit70000jfb805rcj4xj	platform	wechat	微信	1	t	2026-08-18 19:23:02.011	2026-08-18 19:23:02.011
cmsz1vitd0001jfb8s3bi2htz	platform	douyin	抖音	2	t	2026-08-18 19:23:02.017	2026-08-18 19:23:02.017
cmsz1vite0002jfb8gj3vbh0d	platform	xiaohongshu	小红书	3	t	2026-08-18 19:23:02.019	2026-08-18 19:23:02.019
cmsz1vitg0003jfb8b4f7ti1u	platform	wechat_mini_program	微信小程序	4	t	2026-08-18 19:23:02.02	2026-08-18 19:23:02.02
cmsz1vith0004jfb80iojfcm6	platform	app	App	5	t	2026-08-18 19:23:02.021	2026-08-18 19:23:02.021
cmsz1viti0005jfb8xswpowu9	platform	web	Web	6	t	2026-08-18 19:23:02.022	2026-08-18 19:23:02.022
cmsz1vitj0006jfb8errg03fh	industry	retail	零售	1	t	2026-08-18 19:23:02.024	2026-08-18 19:23:02.024
cmsz1vitk0007jfb85hyh4bm3	industry	fmcg	快消	2	t	2026-08-18 19:23:02.025	2026-08-18 19:23:02.025
cmsz1vitm0008jfb8ow7cw7g0	industry	education	教育	3	t	2026-08-18 19:23:02.026	2026-08-18 19:23:02.026
cmsz1vitn0009jfb8564bc5m9	industry	healthcare	医疗健康	4	t	2026-08-18 19:23:02.027	2026-08-18 19:23:02.027
cmsz1vito000ajfb8fr66p4no	industry	saas	SaaS	5	t	2026-08-18 19:23:02.028	2026-08-18 19:23:02.028
cmsz1vitp000bjfb8oi7gwqv3	capability	ai_content_generation	AI 内容生成	1	t	2026-08-18 19:23:02.03	2026-08-18 19:23:02.03
cmsz1vitq000cjfb8ow5jvqo9	capability	private_domain	私域运营	2	t	2026-08-18 19:23:02.031	2026-08-18 19:23:02.031
cmsz1vits000djfb8twhvmioj	capability	lead_gen	线索获客	3	t	2026-08-18 19:23:02.032	2026-08-18 19:23:02.032
cmsz1vitt000ejfb8unz835ec	capability	chatbot	智能客服	4	t	2026-08-18 19:23:02.033	2026-08-18 19:23:02.033
cmsz1vitt000fjfb8amr906i0	capability	data_analysis	数据分析	5	t	2026-08-18 19:23:02.034	2026-08-18 19:23:02.034
cmsz1vitu000gjfb8epiemnri	capability	automation	流程自动化	6	t	2026-08-18 19:23:02.035	2026-08-18 19:23:02.035
\.


--
-- Data for Name: solution_artifacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.solution_artifacts (id, run_id, task_id, result_id, kind, uri, path, mime_type, size_bytes, checksum, label, preview, source, object_ref, pii_level, redaction_status, retention_policy, metadata, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: solution_cost_entries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.solution_cost_entries (id, run_id, task_id, provider, operation, skill_code, endpoint, estimated_cost_points, authorized_cost_points, captured_cost_points, refunded_cost_points, billing_status, reservation_id, transaction_id, policy_version, request_hash, idempotency_key, latency_ms, retry_count, redfox_call_log_id, runtime_execution_id, error_code, created_at) FROM stdin;
\.


--
-- Data for Name: solution_results; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.solution_results (id, run_id, task_id, kind, status, business_object_refs, counts, readback, quality_score, completeness, next_action, failure_reason, accepted_at, approved_by, payload_summary, raw_result_json, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: solution_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.solution_runs (id, tenant_id, user_id, package_code, package_name, package_version, catalog_snapshot_hash, trigger, source, parent_run_id, correlation_id, idempotency_key, status, progress, started_at, ended_at, duration_ms, error_code, error_message, input_json, resolved_plan_json, data_object_mapping, risk_level, confirmation_policy, send_mode, dry_run, estimated_cost_points, max_cost_points, actual_cost_points, cost_status, summary_json, output_refs, acceptance_checks, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: solution_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.solution_tasks (id, run_id, step_key, "order", name, type, executor_kind, status, depends_on, attempt, max_attempts, retry_policy, queued_at, started_at, ended_at, duration_ms, input_json, output_json, target_object, reason_code, error_message, runtime_execution_id, redfox_call_log_id, interaction_task_id, agent_session_id, agent_confirmation_id, intelligence_monitor_id, dedupe_key, request_hash, idempotency_key, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: source_contents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.source_contents (id, tenant_id, user_id, platform, account_id, external_content_id, url, content_type, author_identity_id, title, text, published_at, metrics, raw_hash, collected_at, expires_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: sources; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sources (id, name, type, url, config, enabled, last_crawl_time, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: stores; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stores (id, tenant_id, name, address, owner, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: styles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.styles (id, name, description, prompt_template, parameters, created_at, updated_at, is_default, type) FROM stdin;
\.


--
-- Data for Name: suppressions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.suppressions (id, tenant_id, user_id, kind, normalized_value, reason, source_event_id, created_by, created_at, removed_at) FROM stdin;
\.


--
-- Data for Name: system_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.system_configs (key, value, updated_at) FROM stdin;
\.


--
-- Data for Name: system_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.system_logs (id, level, content, created_at) FROM stdin;
\.


--
-- Data for Name: tenant_entitlements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenant_entitlements (id, tenant_id, source, plan, status, features, commercial_execution_allowed, external_subscription_id, period_start, period_end, metadata, created_at, updated_at) FROM stdin;
cmt2qp30m01mq31wmky19eay5	cmt2qp30c01mm31wm61euoou6	kaypal-subscription	FLAGSHIP	active	["auth", "app-market", "crm", "growth", "local-engine"]	t	\N	\N	\N	{"planMode": "trial", "kaypalUserId": null, "localPlanMode": "trial", "localCommercialAllowed": false, "cloudSubscriptionActive": false, "sessionEntitlementSource": "trial"}	2026-08-21 09:21:10.534	2026-08-21 10:09:51.533
cmt2sg20m09eq31wmsgy9aa17	cmt2qp30c01mm31wm61euoou6	trial	FREE	active	["auth", "app-market"]	f	\N	\N	\N	{"planMode": "trial", "kaypalUserId": null, "localPlanMode": "trial", "localCommercialAllowed": false, "cloudSubscriptionActive": false, "sessionEntitlementSource": "trial"}	2026-08-21 10:10:08.567	2026-08-22 01:23:42.615
cmt2sg21009ew31wmdectczx4	cmt2qp30c01mm31wm61euoou6	local-commercial-override	FREE	active	["auth", "app-market", "commercial-execution"]	t	\N	\N	\N	{"planMode": "commercial", "kaypalUserId": null, "localPlanMode": "commercial", "localCommercialAllowed": true, "cloudSubscriptionActive": false, "sessionEntitlementSource": "local-commercial-override"}	2026-08-21 10:10:08.58	2026-08-21 13:08:48.06
cmt2psn5e001kfy4vdvl2pxi6	cmt2psn52001gfy4v46brmz1c	trial	FLAGSHIP	active	["auth", "app-market", "crm", "growth", "local-engine"]	f	\N	\N	\N	{"planMode": "commercial", "kaypalUserId": "cmo9p6i5x000a58uckbcyv45u", "localPlanMode": "commercial", "localCommercialAllowed": true, "cloudSubscriptionActive": true, "sessionEntitlementSource": "kaypal-subscription"}	2026-08-21 08:55:56.978	2026-08-22 10:11:03.316
\.


--
-- Data for Name: tenant_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenant_members (id, tenant_id, user_id, role, status, permissions, joined_at, created_at, updated_at) FROM stdin;
cmt2qp30i01mo31wmrq85szx1	cmt2qp30c01mm31wm61euoou6	usr_test_qa	admin	active	[]	2026-08-21 09:21:10.53	2026-08-21 09:21:10.53	2026-08-22 01:23:42.615
cmt2psn57001ify4vu43s31wf	cmt2psn52001gfy4v46brmz1c	cms2ktllp03u9j1wprksvwy8w	admin	active	[]	2026-08-21 08:55:56.971	2026-08-21 08:55:56.971	2026-08-22 10:11:03.316
\.


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenants (id, name, slug, status, owner_user_id, metadata, created_at, updated_at) FROM stdin;
cmt2qp30c01mm31wm61euoou6	QA测试账号的组织	user-usr_test_qa	active	usr_test_qa	{"source": "default-user-tenant", "createdFromUserId": "usr_test_qa"}	2026-08-21 09:21:10.524	2026-08-22 01:23:42.615
cmt2psn52001gfy4v46brmz1c	验收用户的组织	user-cms2ktllp03u9j1wprksvwy8w	active	cms2ktllp03u9j1wprksvwy8w	{"source": "default-user-tenant", "createdFromUserId": "cms2ktllp03u9j1wprksvwy8w"}	2026-08-21 08:55:56.966	2026-08-22 10:11:03.316
\.


--
-- Data for Name: topic_materials; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.topic_materials (topic_id, material_id) FROM stdin;
\.


--
-- Data for Name: topics; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.topics (id, title, description, summary, source_type, keywords, ai_score, score_details, score_reason, status, is_published, created_at, updated_at, reasoning, search_queries, tenant_id, user_id) FROM stdin;
\.


--
-- Data for Name: user_memories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_memories (id, user_id, type, content, priority, scene, usage_count, last_used_at, source, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_sessions (id, user_id, token_hash, expires_at, last_used_at, created_at, updated_at, metadata) FROM stdin;
cmt2psn5q001mfy4v3itaiuoa	cms2ktllp03u9j1wprksvwy8w	323d884316463c88ca96f9de56a52431822877c5e00a77d262e75ce2c5947f64	2026-09-04 08:55:56.963	2026-08-21 14:39:32.339	2026-08-21 08:55:56.991	2026-08-21 14:39:32.34	{"kaypalRole": null, "kaypalPlatformRole": null, "kaypalCreditBalance": 49133, "kaypalPermissionNames": [], "kaypalMetadataSyncedAt": "2026-08-21T09:54:08.273Z", "kaypalSubscriptionPlan": "FLAGSHIP", "kaypalCreditBalanceUserId": "cmo9p6i5x000a58uckbcyv45u", "kaypalCreditBalanceSyncedAt": "2026-08-21T14:38:41.195Z", "kaypalSubscriptionPeriodEnd": "2036-04-30T04:21:52.432Z"}
cmt2qo9dm01iu31wmk5pd5z89	usr_test_qa	75a153b31a64c76870ff28eb1d62feb881a8b752efe6a0be68d58512383da5fe	2026-09-04 09:20:32.118	2026-08-21 09:20:32.122	2026-08-21 09:20:32.122	2026-08-21 09:20:32.122	\N
cmt47o86g001ggohptyca2aru	cms2ktllp03u9j1wprksvwy8w	2bdbc07ebe2cdb4b4cf6fa207290e10662bd2ef2122783c6687a4690cffcf740	2026-09-05 10:04:10.215	2026-08-22 10:04:10.216	2026-08-22 10:04:10.216	2026-08-22 10:04:10.216	{"localOnly": true, "kaypalLoginMethod": "credentials", "kaypalDesktopDeviceId": "pwd_70d0b562-26bf-40", "kaypalMetadataSyncedAt": "2026-08-22T10:04:10.211Z", "kaypalSubscriptionPlan": "FLAGSHIP", "kaypalDesktopAccessToken": "enc:v1:Tl2jVuIHct4CXBa6.eMcvh40EbGlRpT_4Qb-bkg.2vc7hmYtqAXBwER1K-iIoJIpS-3NFPze9h3z-aqh4Sr8KMYPCnbXpPcUkwp6vK8", "kaypalDesktopRefreshToken": "enc:v1:Qq_TekLh5CWMdB_-.NGsqEwIwSrAYYVN_9ynQOA.MLkgF07EE36nhHRvp7sm6DEQpy8GQXXCS6BbdHtKoPOY5iBCoE97gfANDo5urys", "kaypalDesktopTokenExpiresAt": "2026-08-22T11:04:10.151Z", "kaypalSubscriptionPeriodEnd": "2036-04-30T04:21:52.432Z"}
cmt2ytt2i0034316gg0tjujho	usr_test_qa	360f3183e9646d5e4965e32cd2b4274d539a6db331fe5e54dd86cc474081c297	2026-09-04 13:08:47.847	2026-08-21 13:08:47.851	2026-08-21 13:08:47.851	2026-08-21 13:08:47.851	\N
cmt3o3f1c000431m1lxevsc7n	usr_test_qa	a039437b401c7c1f233a8038df9cc4d63c12b0ec8faea38113bc6fdecdcc4be0	2026-09-05 00:56:06.617	2026-08-22 00:56:06.624	2026-08-22 00:56:06.624	2026-08-22 00:56:06.624	\N
cmt2qowwt01l231wmio62acos	usr_test_qa	3f06426ec030dd0268f9c87abf789fc06805bb40dda0f2aace5d82031f454443	2026-09-04 09:21:02.612	2026-08-21 10:45:54.694	2026-08-21 09:21:02.621	2026-08-21 10:45:54.695	\N
cmt47wode0004go5awdgg4bj0	cms2ktllp03u9j1wprksvwy8w	912d1b1382a7319738ddbb7de0ceb913be8b9c455ed62bf4bf7b66388d39253e	2026-09-05 10:10:44.45	2026-08-22 10:10:44.451	2026-08-22 10:10:44.451	2026-08-22 10:10:44.451	{"localOnly": true, "kaypalLoginMethod": "credentials", "kaypalDesktopDeviceId": "pwd_d4897d69-fea4-44", "kaypalMetadataSyncedAt": "2026-08-22T10:10:44.445Z", "kaypalSubscriptionPlan": "FLAGSHIP", "kaypalDesktopAccessToken": "enc:v1:7fxEwIeJcwxf6B6A.m4PaEu27asW1AR_ialZGrA.kpFZx6ZNfpmnIbE91TOD6Uns_49XEaOQT0p6ZvzBjVgZZTx-njWnk6KtD6n8iLQ", "kaypalDesktopRefreshToken": "enc:v1:vYJKScP33ThgSYEd.fmevtG83xvZINPlU5xgHlw.frUTB2LltqsiksM4XaKxUPW_jSTbl4bDuQ3rJFYRxLEPbKICSU0xO2vRY8MlkUk", "kaypalDesktopTokenExpiresAt": "2026-08-22T11:10:44.387Z", "kaypalSubscriptionPeriodEnd": "2036-04-30T04:21:52.432Z"}
cmt2qgzc3008431wm5k58wh5t	cms2ktllp03u9j1wprksvwy8w	3114e34c59a476f52eed459d8f2c4c682431f95f8cd651a76ed7bc401c5ff353	2026-09-04 09:14:52.514	2026-08-22 10:11:03.203	2026-08-21 09:14:52.515	2026-08-22 10:11:03.204	{"localOnly": true, "kaypalLoginMethod": "credentials", "kaypalCreditBalance": 49133, "kaypalMetadataSyncedAt": "2026-08-21T14:07:29.644Z", "kaypalSubscriptionPlan": "FLAGSHIP", "kaypalCreditBalanceUserId": "cmo9p6i5x000a58uckbcyv45u", "kaypalCreditBalanceSyncedAt": "2026-08-21T14:07:29.647Z", "kaypalSubscriptionPeriodEnd": "2036-04-30T04:21:52.432Z"}
cmt3o3rab000c31m1zawb4y5q	usr_test_qa	986b6e90ff3f54d27d58f0da3fc474cb44e4148a09a127fe8262566a59f18233	2026-09-05 00:56:22.495	2026-08-22 01:23:42.494	2026-08-22 00:56:22.5	2026-08-22 01:23:42.495	\N
cmt47g6vy0004gom11cx3ole8	cms2ktllp03u9j1wprksvwy8w	44b7506a97e54d5a24ac7ff2aae0b428fcc6247298a72b96327d796393cc80ba	2026-09-05 09:57:55.293	2026-08-22 10:02:40.866	2026-08-22 09:57:55.294	2026-08-22 10:02:40.866	{"localOnly": true, "kaypalLoginMethod": "credentials", "kaypalDesktopDeviceId": "pwd_9ae2f69d-7ec0-4b", "kaypalMetadataSyncedAt": "2026-08-22T09:57:55.286Z", "kaypalSubscriptionPlan": "FLAGSHIP", "kaypalDesktopAccessToken": "enc:v1:2kOK1qMkj4WcH8De.vxERR--Cuy2WQXu6hEggCQ.Y6bJlXlcIoOkE4-dPc-GGAT4wdeQ5lqFGIXTY00bvt7rEcTTH5nbump2cyn1oLc", "kaypalDesktopRefreshToken": "enc:v1:vtqrxFPJkk9TGUHS.VvsO51mCCcbKcp67-FMOVw.0sb-CCLdtx4mqgLQZUI9hIYkxP9GE0b5jFcaUxLd2ne0srIpvej6CFkmX1VJTu0", "kaypalDesktopTokenExpiresAt": "2026-08-22T10:57:55.233Z", "kaypalSubscriptionPeriodEnd": "2036-04-30T04:21:52.432Z"}
cmt47c2qc0004gofjanbsyiig	cms2ktllp03u9j1wprksvwy8w	981bd50c7beb23bcea28f9d24cb0dd69c7c3781aa47dc941cb72a0c53b414a56	2026-09-05 09:54:43.284	2026-08-22 09:56:05.408	2026-08-22 09:54:43.285	2026-08-22 09:56:05.408	{"localOnly": true, "kaypalLoginMethod": "credentials", "kaypalDesktopDeviceId": "pwd_43632532-40e5-42", "kaypalMetadataSyncedAt": "2026-08-22T09:54:43.278Z", "kaypalSubscriptionPlan": "FLAGSHIP", "kaypalDesktopAccessToken": "enc:v1:Vr8HEZiAO2ZK8U6w.gdmBojl9iM4AZcru4gkgeA.1z6nHcpmt7WDw3DGHco7PAlFxD6gNQaIIvAWO3OPGf0kDu8b6M5rwFoU7GwnYpU", "kaypalDesktopRefreshToken": "enc:v1:b4l1_8FvcuGGZfMe.ynhW96OU102bJNGdAuquew.qucYVuw4twr4fP0ZKwTCPnB4aXMSag4PvGcTyeIJcoiRasNq0NlFVp6iA27J17g", "kaypalDesktopTokenExpiresAt": "2026-08-22T10:54:43.212Z", "kaypalSubscriptionPeriodEnd": "2036-04-30T04:21:52.432Z"}
cmt47skkl0004goq2965yw3d5	cms2ktllp03u9j1wprksvwy8w	3eb0bd72709764e59f13cc783a2353e47ae24583ec6ed961cd780cad2eff019b	2026-09-05 10:07:32.9	2026-08-22 10:08:38.77	2026-08-22 10:07:32.901	2026-08-22 10:08:38.772	{"localOnly": true, "kaypalLoginMethod": "credentials", "kaypalDesktopDeviceId": "pwd_543fcc56-a41d-40", "kaypalMetadataSyncedAt": "2026-08-22T10:07:32.895Z", "kaypalSubscriptionPlan": "FLAGSHIP", "kaypalDesktopAccessToken": "enc:v1:xKl_oaEyqnMOsgyg.ZqvKyks8SPwpTTT1QiT64Q.vC5FPH5j69enaGjsuOid7go2hCQEB7zb7b2XCz4h-u9-64P6xJ6JvpQLNpE_Sts", "kaypalDesktopRefreshToken": "enc:v1:jLvSszTyj71ipLes.VICr-2wd869m0scMejxsxg.UfPScVawzTruA8TEMx0v3zbTCeMxpSyhUVt7XO1CRldWwmZ-Fd3yp92_K4udZzI", "kaypalDesktopTokenExpiresAt": "2026-08-22T11:07:32.841Z", "kaypalSubscriptionPeriodEnd": "2036-04-30T04:21:52.432Z"}
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, password_hash, name, status, last_login_at, created_at, updated_at, username, kaypal_user_id, commercial_execution_allowed, plan_mode, role, avatar) FROM stdin;
cms2tropz0000312qnzbt9gm8	cw_s3_observer_20260726_225115@example.invalid	1cc90d1c740cd68cfa915e05397848c7:ef1d490f1af2e8ffc14d1f5b8cbdcebb8e78c6dcea7c73cce439d61afd015394fb0698a7d1be282d6e6a3b100e40c182d7e777a4b3e7632c2ea780e64d2ba988	S3 灰度观察账号	active	\N	2026-08-21 08:50:18.244	2026-08-21 08:50:18.244	cw_s3_observer_20260726_225115	\N	f	trial	operator	\N
cmsmjmskh01xwi5opfmpmu30n	wx_o7qJy2ZEMJUdnQR0o_mPemWchCCw@wechat.connect	51c42cab1528161afd94a19259ccdd49:ba62a69a7717c16f8a25b648569eb139b6a41efdd8b5e5cff2f6f31902adb442828a41feaa86b42fd0006572d70807e1092161e5f98c3c02147563d6c92123c8	杨宏宇	active	\N	2026-08-21 08:50:18.244	2026-08-21 08:50:18.244	kaypal_cmsfztrqn0000rofgh921kck7	cmsfztrqn0000rofgh921kck7	f	trial	operator	\N
usr___REDACTED_TEST_USER__	__REDACTED_TEST_USER__@local	24239bfe8de69c8d283e9fa5d850204b:73ffa6c25d6e56112f093501d3a0688da9ce9a35e081d85da876553974de914e7e3f9947d9ce82c2e7702f66de9396473161790f466e00589b9408fee57ef004	测试运营账号	active	\N	2026-08-21 08:50:18.244	2026-08-21 08:50:18.244	__REDACTED_TEST_USER__	\N	t	commercial	admin	\N
usr_test_qa	qa_test@local	9aa3abf0ad5f2293256f5fe8eb7e925f:d0042d0b5696e819654b61055e62d83fdb54344a1ca4c6abe94465d447104d7c4f0b646fc7dc2eb04bb061ea3316014aae9f4c94e02a52906588dc54055d7f78	QA测试账号	active	2026-08-22 00:56:22.502	2026-08-21 09:20:09.861	2026-08-22 00:56:22.503	qa_test	\N	f	trial	admin	\N
cms2ktllp03u9j1wprksvwy8w	phone-__REDACTED_TEST_USER__@kaypal.invalid	c8de83030ffd31440ec06a73d1435b81:d1f7a680db300a074b36528691bb84b94548cbab9d0c2a4029038ce259f292c902d3135acf3d7d709bdce31cf6b13409589ee88ed5ae4cb07aadfcfd056b388c	验收用户	active	2026-08-22 10:10:44.447	2026-08-21 08:50:18.244	2026-08-22 10:10:44.448	kaypal_cmo9p6i5x000a58uckbcyv45u	cmo9p6i5x000a58uckbcyv45u	t	commercial	admin	\N
\.


--
-- Data for Name: wechat_pay_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wechat_pay_orders (id, tenant_id, user_id, out_trade_no, mchid, appid, description, amount_cents, currency, status, transaction_id, credit_points, paid_at, notify_payload, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: wecom_assistant_integrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wecom_assistant_integrations (id, user_id, name, encrypted_webhook_url, masked_webhook_url, status, last_tested_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: wecom_assistant_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wecom_assistant_settings (id, integration_id, user_id, brand_name, store_name, reply_style, transfer_keywords, send_to_wecom, auto_send_to_customer, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: wecom_contacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wecom_contacts (id, config_id, external_user_id, name, avatar, type, user_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: wecom_corp_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wecom_corp_configs (id, user_id, name, corp_id, encrypted_corp_secret, agent_id, status, callback_token, callback_encoding_aes_key, callback_url, callback_url_verified_at, last_token_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: wecom_group_msg_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wecom_group_msg_tasks (id, user_id, config_id, msg_type, content, external_user_ids, sender_ids, wecom_msg_id, status, result, error_message, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: wecom_moment_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wecom_moment_tasks (id, user_id, config_id, text, attachments, visible_range, wecom_job_id, status, result, error_message, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: wecom_outbound_messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wecom_outbound_messages (id, user_id, integration_id, channel, message_type, content, status, error_message, sent_at, created_at) FROM stdin;
\.


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: account_subscriptions account_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_subscriptions
    ADD CONSTRAINT account_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: acquisition_quotas acquisition_quotas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acquisition_quotas
    ADD CONSTRAINT acquisition_quotas_pkey PRIMARY KEY (id);


--
-- Name: activation_events activation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_events
    ADD CONSTRAINT activation_events_pkey PRIMARY KEY (id);


--
-- Name: ai_call_traces ai_call_traces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_call_traces
    ADD CONSTRAINT ai_call_traces_pkey PRIMARY KEY (id);


--
-- Name: ai_chat_logs ai_chat_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_chat_logs
    ADD CONSTRAINT ai_chat_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_credit_accounts ai_credit_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_credit_accounts
    ADD CONSTRAINT ai_credit_accounts_pkey PRIMARY KEY (id);


--
-- Name: ai_models ai_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_models
    ADD CONSTRAINT ai_models_pkey PRIMARY KEY (id);


--
-- Name: ai_platforms ai_platforms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_platforms
    ADD CONSTRAINT ai_platforms_pkey PRIMARY KEY (id);


--
-- Name: ai_tool_call_logs ai_tool_call_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_tool_call_logs
    ADD CONSTRAINT ai_tool_call_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_quotas ai_usage_quotas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_quotas
    ADD CONSTRAINT ai_usage_quotas_pkey PRIMARY KEY (id);


--
-- Name: app_install_states app_install_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_install_states
    ADD CONSTRAINT app_install_states_pkey PRIMARY KEY (id);


--
-- Name: approvals approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);


--
-- Name: articles articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_pkey PRIMARY KEY (id);


--
-- Name: attribution_links attribution_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attribution_links
    ADD CONSTRAINT attribution_links_pkey PRIMARY KEY (id);


--
-- Name: benchmark_accounts benchmark_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmark_accounts
    ADD CONSTRAINT benchmark_accounts_pkey PRIMARY KEY (id);


--
-- Name: billing_invoices billing_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_pkey PRIMARY KEY (id);


--
-- Name: billing_subscriptions billing_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: billing_webhook_events billing_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: boss_accounts boss_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boss_accounts
    ADD CONSTRAINT boss_accounts_pkey PRIMARY KEY (id);


--
-- Name: boss_candidates boss_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boss_candidates
    ADD CONSTRAINT boss_candidates_pkey PRIMARY KEY (id);


--
-- Name: boss_tasks boss_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boss_tasks
    ADD CONSTRAINT boss_tasks_pkey PRIMARY KEY (id);


--
-- Name: brand_knowledge brand_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_knowledge
    ADD CONSTRAINT brand_knowledge_pkey PRIMARY KEY (id);


--
-- Name: client_configs client_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_configs
    ADD CONSTRAINT client_configs_pkey PRIMARY KEY (key);


--
-- Name: comment_insights comment_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_insights
    ADD CONSTRAINT comment_insights_pkey PRIMARY KEY (id);


--
-- Name: compliance_checks compliance_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_checks
    ADD CONSTRAINT compliance_checks_pkey PRIMARY KEY (id);


--
-- Name: content_asset_versions content_asset_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_asset_versions
    ADD CONSTRAINT content_asset_versions_pkey PRIMARY KEY (id);


--
-- Name: content_drafts content_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_drafts
    ADD CONSTRAINT content_drafts_pkey PRIMARY KEY (id);


--
-- Name: content_evidence_logs content_evidence_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_evidence_logs
    ADD CONSTRAINT content_evidence_logs_pkey PRIMARY KEY (id);


--
-- Name: content_manual_reviews content_manual_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_manual_reviews
    ADD CONSTRAINT content_manual_reviews_pkey PRIMARY KEY (id);


--
-- Name: content_optimization_runs content_optimization_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_optimization_runs
    ADD CONSTRAINT content_optimization_runs_pkey PRIMARY KEY (id);


--
-- Name: content_plans content_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_plans
    ADD CONSTRAINT content_plans_pkey PRIMARY KEY (id);


--
-- Name: content_publish_feedback content_publish_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_publish_feedback
    ADD CONSTRAINT content_publish_feedback_pkey PRIMARY KEY (id);


--
-- Name: content_publish_intents content_publish_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_publish_intents
    ADD CONSTRAINT content_publish_intents_pkey PRIMARY KEY (id);


--
-- Name: content_strategies content_strategies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_strategies
    ADD CONSTRAINT content_strategies_pkey PRIMARY KEY (id);


--
-- Name: content_strategy_templates content_strategy_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_strategy_templates
    ADD CONSTRAINT content_strategy_templates_pkey PRIMARY KEY (id);


--
-- Name: content_variants content_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_variants
    ADD CONSTRAINT content_variants_pkey PRIMARY KEY (id);


--
-- Name: content_version_comments content_version_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_version_comments
    ADD CONSTRAINT content_version_comments_pkey PRIMARY KEY (id);


--
-- Name: content_versions content_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_versions
    ADD CONSTRAINT content_versions_pkey PRIMARY KEY (id);


--
-- Name: cps_favorites cps_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cps_favorites
    ADD CONSTRAINT cps_favorites_pkey PRIMARY KEY (id);


--
-- Name: cps_orders cps_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cps_orders
    ADD CONSTRAINT cps_orders_pkey PRIMARY KEY (id);


--
-- Name: cps_platforms cps_platforms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cps_platforms
    ADD CONSTRAINT cps_platforms_pkey PRIMARY KEY (id);


--
-- Name: cps_promo_links cps_promo_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cps_promo_links
    ADD CONSTRAINT cps_promo_links_pkey PRIMARY KEY (id);


--
-- Name: cps_vendors cps_vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cps_vendors
    ADD CONSTRAINT cps_vendors_pkey PRIMARY KEY (id);


--
-- Name: crm_audit_events crm_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_audit_events
    ADD CONSTRAINT crm_audit_events_pkey PRIMARY KEY (id);


--
-- Name: crm_companies crm_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_companies
    ADD CONSTRAINT crm_companies_pkey PRIMARY KEY (id);


--
-- Name: crm_customers crm_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_customers
    ADD CONSTRAINT crm_customers_pkey PRIMARY KEY (id);


--
-- Name: crm_import_batches crm_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_import_batches
    ADD CONSTRAINT crm_import_batches_pkey PRIMARY KEY (id);


--
-- Name: crm_notes crm_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_pkey PRIMARY KEY (id);


--
-- Name: crm_opportunities crm_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_pkey PRIMARY KEY (id);


--
-- Name: crm_tasks crm_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_pkey PRIMARY KEY (id);


--
-- Name: crm_timeline_events crm_timeline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_timeline_events
    ADD CONSTRAINT crm_timeline_events_pkey PRIMARY KEY (id);


--
-- Name: default_model_configs default_model_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_model_configs
    ADD CONSTRAINT default_model_configs_pkey PRIMARY KEY (id);


--
-- Name: domain_event_outbox domain_event_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_event_outbox
    ADD CONSTRAINT domain_event_outbox_pkey PRIMARY KEY (id);


--
-- Name: entitlement_snapshots entitlement_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_snapshots
    ADD CONSTRAINT entitlement_snapshots_pkey PRIMARY KEY (id);


--
-- Name: executor_tasks executor_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executor_tasks
    ADD CONSTRAINT executor_tasks_pkey PRIMARY KEY (id);


--
-- Name: exposure_accounts exposure_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exposure_accounts
    ADD CONSTRAINT exposure_accounts_pkey PRIMARY KEY (id);


--
-- Name: geo_bridge_tasks geo_bridge_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_bridge_tasks
    ADD CONSTRAINT geo_bridge_tasks_pkey PRIMARY KEY (id);


--
-- Name: growth_account_health growth_account_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_account_health
    ADD CONSTRAINT growth_account_health_pkey PRIMARY KEY (id);


--
-- Name: growth_account_health_snapshots growth_account_health_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_account_health_snapshots
    ADD CONSTRAINT growth_account_health_snapshots_pkey PRIMARY KEY (id);


--
-- Name: growth_acquisition_configs growth_acquisition_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_acquisition_configs
    ADD CONSTRAINT growth_acquisition_configs_pkey PRIMARY KEY (id);


--
-- Name: growth_acquisition_runs growth_acquisition_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_acquisition_runs
    ADD CONSTRAINT growth_acquisition_runs_pkey PRIMARY KEY (id);


--
-- Name: growth_leads growth_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_leads
    ADD CONSTRAINT growth_leads_pkey PRIMARY KEY (id);


--
-- Name: growth_scheduler_leases growth_scheduler_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_scheduler_leases
    ADD CONSTRAINT growth_scheduler_leases_pkey PRIMARY KEY (id);


--
-- Name: growth_strategies growth_strategies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_strategies
    ADD CONSTRAINT growth_strategies_pkey PRIMARY KEY (id);


--
-- Name: growth_task_drafts growth_task_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_task_drafts
    ADD CONSTRAINT growth_task_drafts_pkey PRIMARY KEY (id);


--
-- Name: growth_workflows growth_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_workflows
    ADD CONSTRAINT growth_workflows_pkey PRIMARY KEY (id);


--
-- Name: identity_merge_audits identity_merge_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_merge_audits
    ADD CONSTRAINT identity_merge_audits_pkey PRIMARY KEY (id);


--
-- Name: intelligence_items intelligence_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_items
    ADD CONSTRAINT intelligence_items_pkey PRIMARY KEY (id);


--
-- Name: intelligence_monitors intelligence_monitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_monitors
    ADD CONSTRAINT intelligence_monitors_pkey PRIMARY KEY (id);


--
-- Name: intelligence_reports intelligence_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_reports
    ADD CONSTRAINT intelligence_reports_pkey PRIMARY KEY (id);


--
-- Name: interaction_events interaction_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_pkey PRIMARY KEY (id);


--
-- Name: interaction_task_events interaction_task_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_task_events
    ADD CONSTRAINT interaction_task_events_pkey PRIMARY KEY (id);


--
-- Name: interaction_tasks interaction_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_tasks
    ADD CONSTRAINT interaction_tasks_pkey PRIMARY KEY (id);


--
-- Name: lead_event_outbox lead_event_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_event_outbox
    ADD CONSTRAINT lead_event_outbox_pkey PRIMARY KEY (id);


--
-- Name: lead_score_snapshots lead_score_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_score_snapshots
    ADD CONSTRAINT lead_score_snapshots_pkey PRIMARY KEY (id);


--
-- Name: lead_signals lead_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_signals
    ADD CONSTRAINT lead_signals_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: local_engine_agent_confirmations local_engine_agent_confirmations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_engine_agent_confirmations
    ADD CONSTRAINT local_engine_agent_confirmations_pkey PRIMARY KEY (id);


--
-- Name: local_engine_agent_sessions local_engine_agent_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_engine_agent_sessions
    ADD CONSTRAINT local_engine_agent_sessions_pkey PRIMARY KEY (id);


--
-- Name: local_engine_reply_rules local_engine_reply_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_engine_reply_rules
    ADD CONSTRAINT local_engine_reply_rules_pkey PRIMARY KEY (id);


--
-- Name: materials materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (id);


--
-- Name: mobile_devices mobile_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_devices
    ADD CONSTRAINT mobile_devices_pkey PRIMARY KEY (id);


--
-- Name: offer_snapshots offer_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_snapshots
    ADD CONSTRAINT offer_snapshots_pkey PRIMARY KEY (id);


--
-- Name: platform_identities platform_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_identities
    ADD CONSTRAINT platform_identities_pkey PRIMARY KEY (id);


--
-- Name: poi_stores poi_stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poi_stores
    ADD CONSTRAINT poi_stores_pkey PRIMARY KEY (id);


--
-- Name: price_histories price_histories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_histories
    ADD CONSTRAINT price_histories_pkey PRIMARY KEY (id);


--
-- Name: price_watches price_watches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_watches
    ADD CONSTRAINT price_watches_pkey PRIMARY KEY (id);


--
-- Name: procurement_lists procurement_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_lists
    ADD CONSTRAINT procurement_lists_pkey PRIMARY KEY (id);


--
-- Name: product_clip_configs product_clip_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_clip_configs
    ADD CONSTRAINT product_clip_configs_pkey PRIMARY KEY (id);


--
-- Name: product_masters product_masters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_masters
    ADD CONSTRAINT product_masters_pkey PRIMARY KEY (id);


--
-- Name: publish_accounts publish_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_accounts
    ADD CONSTRAINT publish_accounts_pkey PRIMARY KEY (id);


--
-- Name: publish_jobs publish_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_jobs
    ADD CONSTRAINT publish_jobs_pkey PRIMARY KEY (id);


--
-- Name: publish_receipts publish_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_receipts
    ADD CONSTRAINT publish_receipts_pkey PRIMARY KEY (id);


--
-- Name: publish_records publish_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_records
    ADD CONSTRAINT publish_records_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: rebate_accounts rebate_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rebate_accounts
    ADD CONSTRAINT rebate_accounts_pkey PRIMARY KEY (id);


--
-- Name: rebate_exchanges rebate_exchanges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rebate_exchanges
    ADD CONSTRAINT rebate_exchanges_pkey PRIMARY KEY (id);


--
-- Name: rebate_ledgers rebate_ledgers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rebate_ledgers
    ADD CONSTRAINT rebate_ledgers_pkey PRIMARY KEY (id);


--
-- Name: rebate_withdrawals rebate_withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rebate_withdrawals
    ADD CONSTRAINT rebate_withdrawals_pkey PRIMARY KEY (id);


--
-- Name: redfox_call_logs redfox_call_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_call_logs
    ADD CONSTRAINT redfox_call_logs_pkey PRIMARY KEY (id);


--
-- Name: redfox_connections redfox_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_connections
    ADD CONSTRAINT redfox_connections_pkey PRIMARY KEY (id);


--
-- Name: redfox_interfaces redfox_interfaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_interfaces
    ADD CONSTRAINT redfox_interfaces_pkey PRIMARY KEY (id);


--
-- Name: redfox_skill_installs redfox_skill_installs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_skill_installs
    ADD CONSTRAINT redfox_skill_installs_pkey PRIMARY KEY (id);


--
-- Name: redfox_skills redfox_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_skills
    ADD CONSTRAINT redfox_skills_pkey PRIMARY KEY (id);


--
-- Name: review_runs review_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_runs
    ADD CONSTRAINT review_runs_pkey PRIMARY KEY (id);


--
-- Name: risk_policies risk_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_policies
    ADD CONSTRAINT risk_policies_pkey PRIMARY KEY (id);


--
-- Name: rpa_evidence rpa_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpa_evidence
    ADD CONSTRAINT rpa_evidence_pkey PRIMARY KEY (id);


--
-- Name: rpa_execution_steps rpa_execution_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpa_execution_steps
    ADD CONSTRAINT rpa_execution_steps_pkey PRIMARY KEY (id);


--
-- Name: rpa_executions rpa_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpa_executions
    ADD CONSTRAINT rpa_executions_pkey PRIMARY KEY (id);


--
-- Name: runtime_executions runtime_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_executions
    ADD CONSTRAINT runtime_executions_pkey PRIMARY KEY (id);


--
-- Name: savings_checkins savings_checkins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_checkins
    ADD CONSTRAINT savings_checkins_pkey PRIMARY KEY (id);


--
-- Name: schedule_configs schedule_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_configs
    ADD CONSTRAINT schedule_configs_pkey PRIMARY KEY (id);


--
-- Name: showcase_authorizations showcase_authorizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_authorizations
    ADD CONSTRAINT showcase_authorizations_pkey PRIMARY KEY (id);


--
-- Name: showcase_case_reviews showcase_case_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_case_reviews
    ADD CONSTRAINT showcase_case_reviews_pkey PRIMARY KEY (id);


--
-- Name: showcase_cases showcase_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_cases
    ADD CONSTRAINT showcase_cases_pkey PRIMARY KEY (id);


--
-- Name: showcase_collection_items showcase_collection_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_collection_items
    ADD CONSTRAINT showcase_collection_items_pkey PRIMARY KEY (collection_id, case_id);


--
-- Name: showcase_collections showcase_collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_collections
    ADD CONSTRAINT showcase_collections_pkey PRIMARY KEY (id);


--
-- Name: showcase_demo_endpoints showcase_demo_endpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_demo_endpoints
    ADD CONSTRAINT showcase_demo_endpoints_pkey PRIMARY KEY (id);


--
-- Name: showcase_media showcase_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_media
    ADD CONSTRAINT showcase_media_pkey PRIMARY KEY (id);


--
-- Name: showcase_short_links showcase_short_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_short_links
    ADD CONSTRAINT showcase_short_links_pkey PRIMARY KEY (id);


--
-- Name: showcase_tag_aliases showcase_tag_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_tag_aliases
    ADD CONSTRAINT showcase_tag_aliases_pkey PRIMARY KEY (id);


--
-- Name: showcase_taxonomies showcase_taxonomies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_taxonomies
    ADD CONSTRAINT showcase_taxonomies_pkey PRIMARY KEY (id);


--
-- Name: solution_artifacts solution_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_artifacts
    ADD CONSTRAINT solution_artifacts_pkey PRIMARY KEY (id);


--
-- Name: solution_cost_entries solution_cost_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_cost_entries
    ADD CONSTRAINT solution_cost_entries_pkey PRIMARY KEY (id);


--
-- Name: solution_results solution_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_results
    ADD CONSTRAINT solution_results_pkey PRIMARY KEY (id);


--
-- Name: solution_runs solution_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_runs
    ADD CONSTRAINT solution_runs_pkey PRIMARY KEY (id);


--
-- Name: solution_tasks solution_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_tasks
    ADD CONSTRAINT solution_tasks_pkey PRIMARY KEY (id);


--
-- Name: source_contents source_contents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_contents
    ADD CONSTRAINT source_contents_pkey PRIMARY KEY (id);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: styles styles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.styles
    ADD CONSTRAINT styles_pkey PRIMARY KEY (id);


--
-- Name: suppressions suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressions
    ADD CONSTRAINT suppressions_pkey PRIMARY KEY (id);


--
-- Name: system_configs system_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_configs
    ADD CONSTRAINT system_configs_pkey PRIMARY KEY (key);


--
-- Name: system_logs system_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);


--
-- Name: tenant_entitlements tenant_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_entitlements
    ADD CONSTRAINT tenant_entitlements_pkey PRIMARY KEY (id);


--
-- Name: tenant_members tenant_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: topic_materials topic_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_materials
    ADD CONSTRAINT topic_materials_pkey PRIMARY KEY (topic_id, material_id);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);


--
-- Name: user_memories user_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memories
    ADD CONSTRAINT user_memories_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wechat_pay_orders wechat_pay_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wechat_pay_orders
    ADD CONSTRAINT wechat_pay_orders_pkey PRIMARY KEY (id);


--
-- Name: wecom_assistant_integrations wecom_assistant_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_assistant_integrations
    ADD CONSTRAINT wecom_assistant_integrations_pkey PRIMARY KEY (id);


--
-- Name: wecom_assistant_settings wecom_assistant_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_assistant_settings
    ADD CONSTRAINT wecom_assistant_settings_pkey PRIMARY KEY (id);


--
-- Name: wecom_contacts wecom_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_contacts
    ADD CONSTRAINT wecom_contacts_pkey PRIMARY KEY (id);


--
-- Name: wecom_corp_configs wecom_corp_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_corp_configs
    ADD CONSTRAINT wecom_corp_configs_pkey PRIMARY KEY (id);


--
-- Name: wecom_group_msg_tasks wecom_group_msg_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_group_msg_tasks
    ADD CONSTRAINT wecom_group_msg_tasks_pkey PRIMARY KEY (id);


--
-- Name: wecom_moment_tasks wecom_moment_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_moment_tasks
    ADD CONSTRAINT wecom_moment_tasks_pkey PRIMARY KEY (id);


--
-- Name: wecom_outbound_messages wecom_outbound_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_outbound_messages
    ADD CONSTRAINT wecom_outbound_messages_pkey PRIMARY KEY (id);


--
-- Name: account_subscriptions_tenant_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_subscriptions_tenant_id_user_id_idx ON public.account_subscriptions USING btree (tenant_id, user_id);


--
-- Name: account_subscriptions_user_id_platform_account_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_subscriptions_user_id_platform_account_id_key ON public.account_subscriptions USING btree (user_id, platform, account_id);


--
-- Name: acquisition_quotas_user_id_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX acquisition_quotas_user_id_date_key ON public.acquisition_quotas USING btree (user_id, date);


--
-- Name: activation_events_tenant_id_event_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activation_events_tenant_id_event_type_created_at_idx ON public.activation_events USING btree (tenant_id, event_type, created_at);


--
-- Name: activation_events_user_id_event_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX activation_events_user_id_event_type_key ON public.activation_events USING btree (user_id, event_type);


--
-- Name: ai_call_traces_scene_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_call_traces_scene_created_at_idx ON public.ai_call_traces USING btree (scene, created_at);


--
-- Name: ai_call_traces_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_call_traces_user_id_created_at_idx ON public.ai_call_traces USING btree (user_id, created_at);


--
-- Name: ai_chat_logs_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_chat_logs_user_id_created_at_idx ON public.ai_chat_logs USING btree (user_id, created_at);


--
-- Name: ai_credit_accounts_tenant_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_credit_accounts_tenant_id_user_id_key ON public.ai_credit_accounts USING btree (tenant_id, user_id);


--
-- Name: ai_models_platform_id_model_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_models_platform_id_model_id_key ON public.ai_models USING btree (platform_id, model_id);


--
-- Name: ai_platforms_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_platforms_name_key ON public.ai_platforms USING btree (name);


--
-- Name: ai_tool_call_logs_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_tool_call_logs_user_id_created_at_idx ON public.ai_tool_call_logs USING btree (user_id, created_at);


--
-- Name: ai_usage_quotas_user_id_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_usage_quotas_user_id_date_key ON public.ai_usage_quotas USING btree (user_id, date);


--
-- Name: app_install_states_actor_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_install_states_actor_user_id_idx ON public.app_install_states USING btree (actor_user_id);


--
-- Name: app_install_states_app_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_install_states_app_key_idx ON public.app_install_states USING btree (app_key);


--
-- Name: app_install_states_install_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_install_states_install_status_idx ON public.app_install_states USING btree (install_status);


--
-- Name: app_install_states_purchase_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_install_states_purchase_status_idx ON public.app_install_states USING btree (purchase_status);


--
-- Name: app_install_states_tenant_id_app_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_install_states_tenant_id_app_key_key ON public.app_install_states USING btree (tenant_id, app_key);


--
-- Name: app_install_states_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_install_states_tenant_id_idx ON public.app_install_states USING btree (tenant_id);


--
-- Name: app_install_states_user_id_app_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_install_states_user_id_app_key_key ON public.app_install_states USING btree (user_id, app_key);


--
-- Name: app_install_states_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_install_states_user_id_idx ON public.app_install_states USING btree (user_id);


--
-- Name: approvals_tenant_id_action_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_tenant_id_action_id_idx ON public.approvals USING btree (tenant_id, action_id);


--
-- Name: approvals_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_tenant_id_status_idx ON public.approvals USING btree (tenant_id, status);


--
-- Name: articles_content_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_content_type_idx ON public.articles USING btree (content_type);


--
-- Name: articles_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_parent_id_idx ON public.articles USING btree (parent_id);


--
-- Name: articles_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_status_idx ON public.articles USING btree (status);


--
-- Name: articles_template_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_template_id_idx ON public.articles USING btree (template_id);


--
-- Name: articles_tenant_id_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_tenant_id_user_id_created_at_idx ON public.articles USING btree (tenant_id, user_id, created_at);


--
-- Name: articles_topic_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_topic_id_idx ON public.articles USING btree (topic_id);


--
-- Name: attribution_links_tenant_id_from_type_from_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribution_links_tenant_id_from_type_from_id_idx ON public.attribution_links USING btree (tenant_id, from_type, from_id);


--
-- Name: attribution_links_tenant_id_from_type_from_id_to_type_to_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attribution_links_tenant_id_from_type_from_id_to_type_to_id_key ON public.attribution_links USING btree (tenant_id, from_type, from_id, to_type, to_id, model);


--
-- Name: attribution_links_tenant_id_to_type_to_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribution_links_tenant_id_to_type_to_id_idx ON public.attribution_links USING btree (tenant_id, to_type, to_id);


--
-- Name: benchmark_accounts_growth_lead_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX benchmark_accounts_growth_lead_id_idx ON public.benchmark_accounts USING btree (growth_lead_id);


--
-- Name: benchmark_accounts_intelligence_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX benchmark_accounts_intelligence_item_id_idx ON public.benchmark_accounts USING btree (intelligence_item_id);


--
-- Name: benchmark_accounts_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX benchmark_accounts_platform_idx ON public.benchmark_accounts USING btree (platform);


--
-- Name: benchmark_accounts_tenant_id_platform_external_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX benchmark_accounts_tenant_id_platform_external_user_id_key ON public.benchmark_accounts USING btree (tenant_id, platform, external_user_id);


--
-- Name: benchmark_accounts_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX benchmark_accounts_tenant_id_status_idx ON public.benchmark_accounts USING btree (tenant_id, status);


--
-- Name: benchmark_accounts_user_id_platform_external_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX benchmark_accounts_user_id_platform_external_user_id_key ON public.benchmark_accounts USING btree (user_id, platform, external_user_id);


--
-- Name: benchmark_accounts_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX benchmark_accounts_user_id_status_idx ON public.benchmark_accounts USING btree (user_id, status);


--
-- Name: billing_invoices_external_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_invoices_external_customer_id_idx ON public.billing_invoices USING btree (external_customer_id);


--
-- Name: billing_invoices_external_subscription_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_invoices_external_subscription_id_idx ON public.billing_invoices USING btree (external_subscription_id);


--
-- Name: billing_invoices_failed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_invoices_failed_at_idx ON public.billing_invoices USING btree (failed_at);


--
-- Name: billing_invoices_paid_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_invoices_paid_at_idx ON public.billing_invoices USING btree (paid_at);


--
-- Name: billing_invoices_provider_external_invoice_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX billing_invoices_provider_external_invoice_id_key ON public.billing_invoices USING btree (provider, external_invoice_id);


--
-- Name: billing_invoices_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_invoices_provider_idx ON public.billing_invoices USING btree (provider);


--
-- Name: billing_invoices_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_invoices_status_idx ON public.billing_invoices USING btree (status);


--
-- Name: billing_invoices_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_invoices_tenant_id_idx ON public.billing_invoices USING btree (tenant_id);


--
-- Name: billing_subscriptions_current_period_end_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_subscriptions_current_period_end_idx ON public.billing_subscriptions USING btree (current_period_end);


--
-- Name: billing_subscriptions_plan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_subscriptions_plan_idx ON public.billing_subscriptions USING btree (plan);


--
-- Name: billing_subscriptions_provider_external_subscription_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX billing_subscriptions_provider_external_subscription_id_key ON public.billing_subscriptions USING btree (provider, external_subscription_id);


--
-- Name: billing_subscriptions_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_subscriptions_provider_idx ON public.billing_subscriptions USING btree (provider);


--
-- Name: billing_subscriptions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_subscriptions_status_idx ON public.billing_subscriptions USING btree (status);


--
-- Name: billing_subscriptions_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_subscriptions_tenant_id_idx ON public.billing_subscriptions USING btree (tenant_id);


--
-- Name: billing_webhook_events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_webhook_events_event_type_idx ON public.billing_webhook_events USING btree (event_type);


--
-- Name: billing_webhook_events_external_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_webhook_events_external_customer_id_idx ON public.billing_webhook_events USING btree (external_customer_id);


--
-- Name: billing_webhook_events_external_subscription_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_webhook_events_external_subscription_id_idx ON public.billing_webhook_events USING btree (external_subscription_id);


--
-- Name: billing_webhook_events_processed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_webhook_events_processed_at_idx ON public.billing_webhook_events USING btree (processed_at);


--
-- Name: billing_webhook_events_provider_event_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX billing_webhook_events_provider_event_id_key ON public.billing_webhook_events USING btree (provider, event_id);


--
-- Name: billing_webhook_events_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_webhook_events_provider_idx ON public.billing_webhook_events USING btree (provider);


--
-- Name: billing_webhook_events_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_webhook_events_status_idx ON public.billing_webhook_events USING btree (status);


--
-- Name: billing_webhook_events_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_webhook_events_tenant_id_idx ON public.billing_webhook_events USING btree (tenant_id);


--
-- Name: boss_accounts_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boss_accounts_user_id_idx ON public.boss_accounts USING btree (user_id);


--
-- Name: boss_candidates_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boss_candidates_account_id_idx ON public.boss_candidates USING btree (account_id);


--
-- Name: boss_candidates_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boss_candidates_user_id_idx ON public.boss_candidates USING btree (user_id);


--
-- Name: boss_tasks_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boss_tasks_account_id_idx ON public.boss_tasks USING btree (account_id);


--
-- Name: boss_tasks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boss_tasks_status_idx ON public.boss_tasks USING btree (status);


--
-- Name: boss_tasks_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boss_tasks_user_id_idx ON public.boss_tasks USING btree (user_id);


--
-- Name: brand_knowledge_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_knowledge_tenant_id_idx ON public.brand_knowledge USING btree (tenant_id);


--
-- Name: brand_knowledge_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_knowledge_user_id_created_at_idx ON public.brand_knowledge USING btree (user_id, created_at);


--
-- Name: brand_knowledge_user_id_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_knowledge_user_id_type_idx ON public.brand_knowledge USING btree (user_id, type);


--
-- Name: comment_insights_growth_lead_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_insights_growth_lead_id_idx ON public.comment_insights USING btree (growth_lead_id);


--
-- Name: comment_insights_intelligence_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_insights_intelligence_item_id_idx ON public.comment_insights USING btree (intelligence_item_id);


--
-- Name: comment_insights_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_insights_platform_idx ON public.comment_insights USING btree (platform);


--
-- Name: comment_insights_redfox_call_log_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_insights_redfox_call_log_id_idx ON public.comment_insights USING btree (redfox_call_log_id);


--
-- Name: comment_insights_tenant_id_analyzed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_insights_tenant_id_analyzed_at_idx ON public.comment_insights USING btree (tenant_id, analyzed_at);


--
-- Name: comment_insights_user_id_analyzed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_insights_user_id_analyzed_at_idx ON public.comment_insights USING btree (user_id, analyzed_at);


--
-- Name: compliance_checks_material_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_checks_material_id_idx ON public.compliance_checks USING btree (material_id);


--
-- Name: compliance_checks_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_checks_platform_idx ON public.compliance_checks USING btree (platform);


--
-- Name: compliance_checks_redfox_call_log_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_checks_redfox_call_log_id_idx ON public.compliance_checks USING btree (redfox_call_log_id);


--
-- Name: compliance_checks_risk_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_checks_risk_level_idx ON public.compliance_checks USING btree (risk_level);


--
-- Name: compliance_checks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_checks_status_idx ON public.compliance_checks USING btree (status);


--
-- Name: compliance_checks_target_type_target_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_checks_target_type_target_id_idx ON public.compliance_checks USING btree (target_type, target_id);


--
-- Name: compliance_checks_tenant_id_checked_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_checks_tenant_id_checked_at_idx ON public.compliance_checks USING btree (tenant_id, checked_at);


--
-- Name: compliance_checks_topic_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_checks_topic_id_idx ON public.compliance_checks USING btree (topic_id);


--
-- Name: compliance_checks_user_id_checked_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_checks_user_id_checked_at_idx ON public.compliance_checks USING btree (user_id, checked_at);


--
-- Name: content_asset_versions_asset_type_asset_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_asset_versions_asset_type_asset_id_created_at_idx ON public.content_asset_versions USING btree (asset_type, asset_id, created_at);


--
-- Name: content_asset_versions_asset_type_asset_id_version_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX content_asset_versions_asset_type_asset_id_version_no_key ON public.content_asset_versions USING btree (asset_type, asset_id, version_no);


--
-- Name: content_drafts_tenant_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_drafts_tenant_id_updated_at_idx ON public.content_drafts USING btree (tenant_id, updated_at);


--
-- Name: content_drafts_user_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_drafts_user_id_updated_at_idx ON public.content_drafts USING btree (user_id, updated_at);


--
-- Name: content_evidence_logs_target_type_target_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_evidence_logs_target_type_target_id_idx ON public.content_evidence_logs USING btree (target_type, target_id);


--
-- Name: content_evidence_logs_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_evidence_logs_user_id_created_at_idx ON public.content_evidence_logs USING btree (user_id, created_at);


--
-- Name: content_manual_reviews_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_manual_reviews_user_id_created_at_idx ON public.content_manual_reviews USING btree (user_id, created_at);


--
-- Name: content_manual_reviews_version_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_manual_reviews_version_id_created_at_idx ON public.content_manual_reviews USING btree (version_id, created_at);


--
-- Name: content_optimization_runs_draft_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_optimization_runs_draft_id_created_at_idx ON public.content_optimization_runs USING btree (draft_id, created_at);


--
-- Name: content_optimization_runs_user_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_optimization_runs_user_id_updated_at_idx ON public.content_optimization_runs USING btree (user_id, updated_at);


--
-- Name: content_plans_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_plans_status_idx ON public.content_plans USING btree (status);


--
-- Name: content_plans_tenant_id_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_plans_tenant_id_user_id_status_idx ON public.content_plans USING btree (tenant_id, user_id, status);


--
-- Name: content_publish_feedback_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_publish_feedback_user_id_created_at_idx ON public.content_publish_feedback USING btree (user_id, created_at);


--
-- Name: content_publish_feedback_version_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_publish_feedback_version_id_created_at_idx ON public.content_publish_feedback USING btree (version_id, created_at);


--
-- Name: content_publish_intents_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_publish_intents_user_id_created_at_idx ON public.content_publish_intents USING btree (user_id, created_at);


--
-- Name: content_publish_intents_version_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_publish_intents_version_id_idx ON public.content_publish_intents USING btree (version_id);


--
-- Name: content_strategies_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_strategies_enabled_idx ON public.content_strategies USING btree (enabled);


--
-- Name: content_strategies_is_default_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_strategies_is_default_idx ON public.content_strategies USING btree (is_default);


--
-- Name: content_strategies_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX content_strategies_name_key ON public.content_strategies USING btree (name);


--
-- Name: content_strategy_templates_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_strategy_templates_enabled_idx ON public.content_strategy_templates USING btree (enabled);


--
-- Name: content_strategy_templates_industry_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_strategy_templates_industry_type_idx ON public.content_strategy_templates USING btree (industry, type);


--
-- Name: content_variants_content_unit_id_platform_content_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX content_variants_content_unit_id_platform_content_hash_key ON public.content_variants USING btree (content_unit_id, platform, content_hash);


--
-- Name: content_variants_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_variants_tenant_id_status_idx ON public.content_variants USING btree (tenant_id, status);


--
-- Name: content_version_comments_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_version_comments_user_id_created_at_idx ON public.content_version_comments USING btree (user_id, created_at);


--
-- Name: content_version_comments_version_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_version_comments_version_id_created_at_idx ON public.content_version_comments USING btree (version_id, created_at);


--
-- Name: content_versions_draft_id_version_no_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_versions_draft_id_version_no_idx ON public.content_versions USING btree (draft_id, version_no);


--
-- Name: content_versions_draft_id_version_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX content_versions_draft_id_version_no_key ON public.content_versions USING btree (draft_id, version_no);


--
-- Name: content_versions_is_official_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_versions_is_official_idx ON public.content_versions USING btree (is_official);


--
-- Name: content_versions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_versions_status_idx ON public.content_versions USING btree (status);


--
-- Name: content_versions_tenant_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_versions_tenant_id_updated_at_idx ON public.content_versions USING btree (tenant_id, updated_at);


--
-- Name: content_versions_user_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_versions_user_id_updated_at_idx ON public.content_versions USING btree (user_id, updated_at);


--
-- Name: cps_favorites_tenant_id_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cps_favorites_tenant_id_user_id_created_at_idx ON public.cps_favorites USING btree (tenant_id, user_id, created_at);


--
-- Name: cps_favorites_tenant_id_user_id_item_id_platform_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cps_favorites_tenant_id_user_id_item_id_platform_code_key ON public.cps_favorites USING btree (tenant_id, user_id, item_id, platform_code);


--
-- Name: cps_orders_tenant_id_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cps_orders_tenant_id_user_id_status_idx ON public.cps_orders USING btree (tenant_id, user_id, status);


--
-- Name: cps_orders_vendor_code_order_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cps_orders_vendor_code_order_no_key ON public.cps_orders USING btree (vendor_code, order_no);


--
-- Name: cps_platforms_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cps_platforms_code_key ON public.cps_platforms USING btree (code);


--
-- Name: cps_promo_links_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cps_promo_links_idempotency_key_key ON public.cps_promo_links USING btree (idempotency_key);


--
-- Name: cps_promo_links_tenant_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cps_promo_links_tenant_id_user_id_idx ON public.cps_promo_links USING btree (tenant_id, user_id);


--
-- Name: cps_vendors_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cps_vendors_code_key ON public.cps_vendors USING btree (code);


--
-- Name: crm_audit_events_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_events_action_idx ON public.crm_audit_events USING btree (action);


--
-- Name: crm_audit_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_events_created_at_idx ON public.crm_audit_events USING btree (created_at);


--
-- Name: crm_audit_events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_events_event_type_idx ON public.crm_audit_events USING btree (event_type);


--
-- Name: crm_audit_events_import_batch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_events_import_batch_id_idx ON public.crm_audit_events USING btree (import_batch_id);


--
-- Name: crm_audit_events_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_events_owner_id_idx ON public.crm_audit_events USING btree (owner_id);


--
-- Name: crm_audit_events_proof_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_events_proof_hash_idx ON public.crm_audit_events USING btree (proof_hash);


--
-- Name: crm_audit_events_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_events_status_idx ON public.crm_audit_events USING btree (status);


--
-- Name: crm_audit_events_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_audit_events_tenant_id_idx ON public.crm_audit_events USING btree (tenant_id);


--
-- Name: crm_companies_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_companies_domain_idx ON public.crm_companies USING btree (domain);


--
-- Name: crm_companies_industry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_companies_industry_idx ON public.crm_companies USING btree (industry);


--
-- Name: crm_companies_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_companies_name_idx ON public.crm_companies USING btree (name);


--
-- Name: crm_companies_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_companies_owner_id_idx ON public.crm_companies USING btree (owner_id);


--
-- Name: crm_companies_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_companies_tenant_id_idx ON public.crm_companies USING btree (tenant_id);


--
-- Name: crm_companies_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_companies_updated_at_idx ON public.crm_companies USING btree (updated_at);


--
-- Name: crm_customers_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_customers_company_id_idx ON public.crm_customers USING btree (company_id);


--
-- Name: crm_customers_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_customers_email_idx ON public.crm_customers USING btree (email);


--
-- Name: crm_customers_owner_id_dedupe_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_customers_owner_id_dedupe_key_key ON public.crm_customers USING btree (owner_id, dedupe_key);


--
-- Name: crm_customers_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_customers_owner_id_idx ON public.crm_customers USING btree (owner_id);


--
-- Name: crm_customers_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_customers_phone_idx ON public.crm_customers USING btree (phone);


--
-- Name: crm_customers_source_keyword_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_customers_source_keyword_idx ON public.crm_customers USING btree (source_keyword);


--
-- Name: crm_customers_source_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_customers_source_platform_idx ON public.crm_customers USING btree (source_platform);


--
-- Name: crm_customers_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_customers_status_idx ON public.crm_customers USING btree (status);


--
-- Name: crm_customers_tenant_id_dedupe_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_customers_tenant_id_dedupe_key_key ON public.crm_customers USING btree (tenant_id, dedupe_key);


--
-- Name: crm_customers_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_customers_tenant_id_idx ON public.crm_customers USING btree (tenant_id);


--
-- Name: crm_customers_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_customers_updated_at_idx ON public.crm_customers USING btree (updated_at);


--
-- Name: crm_import_batches_commit_proof_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_import_batches_commit_proof_hash_idx ON public.crm_import_batches USING btree (commit_proof_hash);


--
-- Name: crm_import_batches_committed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_import_batches_committed_at_idx ON public.crm_import_batches USING btree (committed_at);


--
-- Name: crm_import_batches_dry_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_import_batches_dry_run_id_idx ON public.crm_import_batches USING btree (dry_run_id);


--
-- Name: crm_import_batches_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_import_batches_owner_id_idx ON public.crm_import_batches USING btree (owner_id);


--
-- Name: crm_import_batches_rollback_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_import_batches_rollback_token_key ON public.crm_import_batches USING btree (rollback_token);


--
-- Name: crm_import_batches_rolled_back_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_import_batches_rolled_back_at_idx ON public.crm_import_batches USING btree (rolled_back_at);


--
-- Name: crm_import_batches_source_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_import_batches_source_type_idx ON public.crm_import_batches USING btree (source_type);


--
-- Name: crm_import_batches_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_import_batches_status_idx ON public.crm_import_batches USING btree (status);


--
-- Name: crm_import_batches_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_import_batches_tenant_id_idx ON public.crm_import_batches USING btree (tenant_id);


--
-- Name: crm_notes_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_notes_company_id_idx ON public.crm_notes USING btree (company_id);


--
-- Name: crm_notes_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_notes_created_at_idx ON public.crm_notes USING btree (created_at);


--
-- Name: crm_notes_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_notes_customer_id_idx ON public.crm_notes USING btree (customer_id);


--
-- Name: crm_notes_opportunity_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_notes_opportunity_id_idx ON public.crm_notes USING btree (opportunity_id);


--
-- Name: crm_notes_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_notes_owner_id_idx ON public.crm_notes USING btree (owner_id);


--
-- Name: crm_notes_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_notes_tenant_id_idx ON public.crm_notes USING btree (tenant_id);


--
-- Name: crm_opportunities_close_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_close_date_idx ON public.crm_opportunities USING btree (close_date);


--
-- Name: crm_opportunities_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_company_id_idx ON public.crm_opportunities USING btree (company_id);


--
-- Name: crm_opportunities_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_owner_id_idx ON public.crm_opportunities USING btree (owner_id);


--
-- Name: crm_opportunities_primary_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_primary_customer_id_idx ON public.crm_opportunities USING btree (primary_customer_id);


--
-- Name: crm_opportunities_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_stage_idx ON public.crm_opportunities USING btree (stage);


--
-- Name: crm_opportunities_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_tenant_id_idx ON public.crm_opportunities USING btree (tenant_id);


--
-- Name: crm_opportunities_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_updated_at_idx ON public.crm_opportunities USING btree (updated_at);


--
-- Name: crm_tasks_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_company_id_idx ON public.crm_tasks USING btree (company_id);


--
-- Name: crm_tasks_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_customer_id_idx ON public.crm_tasks USING btree (customer_id);


--
-- Name: crm_tasks_due_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_due_at_idx ON public.crm_tasks USING btree (due_at);


--
-- Name: crm_tasks_opportunity_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_opportunity_id_idx ON public.crm_tasks USING btree (opportunity_id);


--
-- Name: crm_tasks_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_owner_id_idx ON public.crm_tasks USING btree (owner_id);


--
-- Name: crm_tasks_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_priority_idx ON public.crm_tasks USING btree (priority);


--
-- Name: crm_tasks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_status_idx ON public.crm_tasks USING btree (status);


--
-- Name: crm_tasks_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_tenant_id_idx ON public.crm_tasks USING btree (tenant_id);


--
-- Name: crm_tasks_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_updated_at_idx ON public.crm_tasks USING btree (updated_at);


--
-- Name: crm_timeline_events_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_company_id_idx ON public.crm_timeline_events USING btree (company_id);


--
-- Name: crm_timeline_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_created_at_idx ON public.crm_timeline_events USING btree (created_at);


--
-- Name: crm_timeline_events_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_customer_id_idx ON public.crm_timeline_events USING btree (customer_id);


--
-- Name: crm_timeline_events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_event_type_idx ON public.crm_timeline_events USING btree (event_type);


--
-- Name: crm_timeline_events_note_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_note_id_idx ON public.crm_timeline_events USING btree (note_id);


--
-- Name: crm_timeline_events_opportunity_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_opportunity_id_idx ON public.crm_timeline_events USING btree (opportunity_id);


--
-- Name: crm_timeline_events_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_owner_id_idx ON public.crm_timeline_events USING btree (owner_id);


--
-- Name: crm_timeline_events_related_interaction_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_related_interaction_task_id_idx ON public.crm_timeline_events USING btree (related_interaction_task_id);


--
-- Name: crm_timeline_events_related_runtime_execution_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_related_runtime_execution_id_idx ON public.crm_timeline_events USING btree (related_runtime_execution_id);


--
-- Name: crm_timeline_events_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_task_id_idx ON public.crm_timeline_events USING btree (task_id);


--
-- Name: crm_timeline_events_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_timeline_events_tenant_id_idx ON public.crm_timeline_events USING btree (tenant_id);


--
-- Name: default_model_configs_purpose_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX default_model_configs_purpose_key ON public.default_model_configs USING btree (purpose);


--
-- Name: domain_event_outbox_event_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX domain_event_outbox_event_id_key ON public.domain_event_outbox USING btree (event_id);


--
-- Name: domain_event_outbox_tenant_id_aggregate_type_aggregate_id_i_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX domain_event_outbox_tenant_id_aggregate_type_aggregate_id_i_key ON public.domain_event_outbox USING btree (tenant_id, aggregate_type, aggregate_id, idempotency_key);


--
-- Name: domain_event_outbox_tenant_id_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX domain_event_outbox_tenant_id_status_created_at_idx ON public.domain_event_outbox USING btree (tenant_id, status, created_at);


--
-- Name: domain_event_outbox_tenant_id_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX domain_event_outbox_tenant_id_type_idx ON public.domain_event_outbox USING btree (tenant_id, type);


--
-- Name: entitlement_snapshots_ref_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entitlement_snapshots_ref_id_idx ON public.entitlement_snapshots USING btree (ref_id);


--
-- Name: entitlement_snapshots_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entitlement_snapshots_user_id_created_at_idx ON public.entitlement_snapshots USING btree (user_id, created_at);


--
-- Name: executor_tasks_device_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX executor_tasks_device_id_idx ON public.executor_tasks USING btree (device_id);


--
-- Name: executor_tasks_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX executor_tasks_user_id_status_idx ON public.executor_tasks USING btree (user_id, status);


--
-- Name: exposure_accounts_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exposure_accounts_user_id_idx ON public.exposure_accounts USING btree (user_id);


--
-- Name: exposure_accounts_user_id_platform_account_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exposure_accounts_user_id_platform_account_id_key ON public.exposure_accounts USING btree (user_id, platform, account_id);


--
-- Name: geo_bridge_tasks_action_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX geo_bridge_tasks_action_id_key ON public.geo_bridge_tasks USING btree (action_id);


--
-- Name: geo_bridge_tasks_brand_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX geo_bridge_tasks_brand_name_idx ON public.geo_bridge_tasks USING btree (brand_name);


--
-- Name: geo_bridge_tasks_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX geo_bridge_tasks_platform_idx ON public.geo_bridge_tasks USING btree (platform);


--
-- Name: geo_bridge_tasks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX geo_bridge_tasks_status_idx ON public.geo_bridge_tasks USING btree (status);


--
-- Name: geo_bridge_tasks_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX geo_bridge_tasks_updated_at_idx ON public.geo_bridge_tasks USING btree (updated_at);


--
-- Name: growth_account_health_snapshots_tenant_id_platform_account__idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_account_health_snapshots_tenant_id_platform_account__idx ON public.growth_account_health_snapshots USING btree (tenant_id, platform, account_id);


--
-- Name: growth_account_health_snapshots_user_id_platform_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_account_health_snapshots_user_id_platform_account_id_idx ON public.growth_account_health_snapshots USING btree (user_id, platform, account_id, checked_at);


--
-- Name: growth_account_health_tenant_id_platform_account_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX growth_account_health_tenant_id_platform_account_id_key ON public.growth_account_health USING btree (tenant_id, platform, account_id);


--
-- Name: growth_account_health_tenant_id_risk_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_account_health_tenant_id_risk_status_idx ON public.growth_account_health USING btree (tenant_id, risk_status);


--
-- Name: growth_account_health_user_id_platform_account_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX growth_account_health_user_id_platform_account_id_key ON public.growth_account_health USING btree (user_id, platform, account_id);


--
-- Name: growth_account_health_user_id_risk_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_account_health_user_id_risk_status_idx ON public.growth_account_health USING btree (user_id, risk_status);


--
-- Name: growth_acquisition_configs_platform_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_acquisition_configs_platform_account_id_idx ON public.growth_acquisition_configs USING btree (platform, account_id);


--
-- Name: growth_acquisition_configs_tenant_id_schedule_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_acquisition_configs_tenant_id_schedule_enabled_idx ON public.growth_acquisition_configs USING btree (tenant_id, schedule_enabled);


--
-- Name: growth_acquisition_configs_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_acquisition_configs_tenant_id_status_idx ON public.growth_acquisition_configs USING btree (tenant_id, status);


--
-- Name: growth_acquisition_configs_user_id_schedule_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_acquisition_configs_user_id_schedule_enabled_idx ON public.growth_acquisition_configs USING btree (user_id, schedule_enabled);


--
-- Name: growth_acquisition_configs_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_acquisition_configs_user_id_status_idx ON public.growth_acquisition_configs USING btree (user_id, status);


--
-- Name: growth_acquisition_runs_config_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_acquisition_runs_config_id_started_at_idx ON public.growth_acquisition_runs USING btree (config_id, started_at);


--
-- Name: growth_acquisition_runs_tenant_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_acquisition_runs_tenant_id_started_at_idx ON public.growth_acquisition_runs USING btree (tenant_id, started_at);


--
-- Name: growth_acquisition_runs_user_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_acquisition_runs_user_id_started_at_idx ON public.growth_acquisition_runs USING btree (user_id, started_at);


--
-- Name: growth_leads_source_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_leads_source_task_id_idx ON public.growth_leads USING btree (source_task_id);


--
-- Name: growth_leads_tenant_id_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_leads_tenant_id_platform_idx ON public.growth_leads USING btree (tenant_id, platform);


--
-- Name: growth_leads_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_leads_tenant_id_status_idx ON public.growth_leads USING btree (tenant_id, status);


--
-- Name: growth_leads_user_id_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_leads_user_id_platform_idx ON public.growth_leads USING btree (user_id, platform);


--
-- Name: growth_leads_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_leads_user_id_status_idx ON public.growth_leads USING btree (user_id, status);


--
-- Name: growth_scheduler_leases_locked_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_scheduler_leases_locked_until_idx ON public.growth_scheduler_leases USING btree (locked_until);


--
-- Name: growth_scheduler_leases_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_scheduler_leases_tenant_id_idx ON public.growth_scheduler_leases USING btree (tenant_id);


--
-- Name: growth_scheduler_leases_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_scheduler_leases_user_id_idx ON public.growth_scheduler_leases USING btree (user_id);


--
-- Name: growth_strategies_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_strategies_tenant_id_idx ON public.growth_strategies USING btree (tenant_id);


--
-- Name: growth_strategies_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_strategies_user_id_idx ON public.growth_strategies USING btree (user_id);


--
-- Name: growth_task_drafts_intent_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_task_drafts_intent_status_idx ON public.growth_task_drafts USING btree (intent, status);


--
-- Name: growth_task_drafts_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_task_drafts_tenant_id_status_idx ON public.growth_task_drafts USING btree (tenant_id, status);


--
-- Name: growth_task_drafts_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_task_drafts_user_id_status_idx ON public.growth_task_drafts USING btree (user_id, status);


--
-- Name: growth_workflows_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_workflows_tenant_id_status_idx ON public.growth_workflows USING btree (tenant_id, status);


--
-- Name: growth_workflows_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_workflows_user_id_status_idx ON public.growth_workflows USING btree (user_id, status);


--
-- Name: identity_merge_audits_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_merge_audits_source_id_idx ON public.identity_merge_audits USING btree (source_id);


--
-- Name: identity_merge_audits_tenant_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_merge_audits_tenant_id_created_at_idx ON public.identity_merge_audits USING btree (tenant_id, created_at);


--
-- Name: intelligence_items_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_created_at_idx ON public.intelligence_items USING btree (created_at);


--
-- Name: intelligence_items_growth_lead_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_growth_lead_id_idx ON public.intelligence_items USING btree (growth_lead_id);


--
-- Name: intelligence_items_material_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_material_id_idx ON public.intelligence_items USING btree (material_id);


--
-- Name: intelligence_items_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_platform_idx ON public.intelligence_items USING btree (platform);


--
-- Name: intelligence_items_redfox_call_log_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_redfox_call_log_id_idx ON public.intelligence_items USING btree (redfox_call_log_id);


--
-- Name: intelligence_items_redfox_skill_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_redfox_skill_id_idx ON public.intelligence_items USING btree (redfox_skill_id);


--
-- Name: intelligence_items_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_source_id_idx ON public.intelligence_items USING btree (source_id);


--
-- Name: intelligence_items_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_status_idx ON public.intelligence_items USING btree (status);


--
-- Name: intelligence_items_tenant_id_dedupe_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX intelligence_items_tenant_id_dedupe_key_key ON public.intelligence_items USING btree (tenant_id, dedupe_key);


--
-- Name: intelligence_items_tenant_id_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_tenant_id_type_idx ON public.intelligence_items USING btree (tenant_id, type);


--
-- Name: intelligence_items_topic_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_topic_id_idx ON public.intelligence_items USING btree (topic_id);


--
-- Name: intelligence_items_user_id_dedupe_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX intelligence_items_user_id_dedupe_key_key ON public.intelligence_items USING btree (user_id, dedupe_key);


--
-- Name: intelligence_items_user_id_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_items_user_id_type_idx ON public.intelligence_items USING btree (user_id, type);


--
-- Name: intelligence_monitors_keyword_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_monitors_keyword_idx ON public.intelligence_monitors USING btree (keyword);


--
-- Name: intelligence_monitors_next_run_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_monitors_next_run_at_idx ON public.intelligence_monitors USING btree (next_run_at);


--
-- Name: intelligence_monitors_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_monitors_platform_idx ON public.intelligence_monitors USING btree (platform);


--
-- Name: intelligence_monitors_skill_install_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_monitors_skill_install_id_idx ON public.intelligence_monitors USING btree (skill_install_id);


--
-- Name: intelligence_monitors_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_monitors_tenant_id_status_idx ON public.intelligence_monitors USING btree (tenant_id, status);


--
-- Name: intelligence_monitors_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_monitors_type_idx ON public.intelligence_monitors USING btree (type);


--
-- Name: intelligence_monitors_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_monitors_user_id_status_idx ON public.intelligence_monitors USING btree (user_id, status);


--
-- Name: intelligence_reports_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_reports_kind_idx ON public.intelligence_reports USING btree (kind);


--
-- Name: intelligence_reports_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_reports_tenant_id_status_idx ON public.intelligence_reports USING btree (tenant_id, status);


--
-- Name: intelligence_reports_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_reports_updated_at_idx ON public.intelligence_reports USING btree (updated_at);


--
-- Name: intelligence_reports_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intelligence_reports_user_id_status_idx ON public.intelligence_reports USING btree (user_id, status);


--
-- Name: interaction_events_author_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interaction_events_author_external_id_idx ON public.interaction_events USING btree (author_external_id);


--
-- Name: interaction_events_content_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interaction_events_content_id_idx ON public.interaction_events USING btree (content_id);


--
-- Name: interaction_events_identity_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interaction_events_identity_id_idx ON public.interaction_events USING btree (identity_id);


--
-- Name: interaction_events_parent_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interaction_events_parent_event_id_idx ON public.interaction_events USING btree (parent_event_id);


--
-- Name: interaction_events_publish_record_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interaction_events_publish_record_id_idx ON public.interaction_events USING btree (publish_record_id);


--
-- Name: interaction_events_source_article_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interaction_events_source_article_id_idx ON public.interaction_events USING btree (source_article_id);


--
-- Name: interaction_events_tenant_id_dedupe_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX interaction_events_tenant_id_dedupe_key_key ON public.interaction_events USING btree (tenant_id, dedupe_key);


--
-- Name: interaction_events_tenant_id_platform_account_id_occurred_a_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interaction_events_tenant_id_platform_account_id_occurred_a_idx ON public.interaction_events USING btree (tenant_id, platform, account_id, occurred_at);


--
-- Name: interaction_task_events_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "interaction_task_events_createdAt_idx" ON public.interaction_task_events USING btree ("createdAt");


--
-- Name: interaction_task_events_taskId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "interaction_task_events_taskId_idx" ON public.interaction_task_events USING btree ("taskId");


--
-- Name: interaction_tasks_accountId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "interaction_tasks_accountId_idx" ON public.interaction_tasks USING btree ("accountId");


--
-- Name: interaction_tasks_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "interaction_tasks_createdAt_idx" ON public.interaction_tasks USING btree ("createdAt");


--
-- Name: interaction_tasks_publishRecordId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "interaction_tasks_publishRecordId_idx" ON public.interaction_tasks USING btree ("publishRecordId");


--
-- Name: interaction_tasks_sessionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "interaction_tasks_sessionId_idx" ON public.interaction_tasks USING btree ("sessionId");


--
-- Name: interaction_tasks_sourceArticleId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "interaction_tasks_sourceArticleId_idx" ON public.interaction_tasks USING btree ("sourceArticleId");


--
-- Name: interaction_tasks_tenant_id_user_id_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "interaction_tasks_tenant_id_user_id_createdAt_idx" ON public.interaction_tasks USING btree (tenant_id, user_id, "createdAt");


--
-- Name: interaction_tasks_tenant_id_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX interaction_tasks_tenant_id_user_id_status_idx ON public.interaction_tasks USING btree (tenant_id, user_id, status);


--
-- Name: interaction_tasks_tenant_id_user_id_taskType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "interaction_tasks_tenant_id_user_id_taskType_idx" ON public.interaction_tasks USING btree (tenant_id, user_id, "taskType");


--
-- Name: lead_event_outbox_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_event_outbox_status_created_at_idx ON public.lead_event_outbox USING btree (status, created_at);


--
-- Name: lead_score_snapshots_tenant_id_lead_id_scored_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_score_snapshots_tenant_id_lead_id_scored_at_idx ON public.lead_score_snapshots USING btree (tenant_id, lead_id, scored_at);


--
-- Name: lead_signals_tenant_id_lead_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_signals_tenant_id_lead_id_idx ON public.lead_signals USING btree (tenant_id, lead_id);


--
-- Name: lead_signals_tenant_id_lead_id_type_evidence_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lead_signals_tenant_id_lead_id_type_evidence_id_key ON public.lead_signals USING btree (tenant_id, lead_id, type, evidence_id);


--
-- Name: lead_signals_tenant_id_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_signals_tenant_id_type_idx ON public.lead_signals USING btree (tenant_id, type);


--
-- Name: leads_source_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_source_task_id_idx ON public.leads USING btree (source_task_id);


--
-- Name: leads_tenant_id_dedupe_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX leads_tenant_id_dedupe_key_key ON public.leads USING btree (tenant_id, dedupe_key);


--
-- Name: leads_tenant_id_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_tenant_id_platform_idx ON public.leads USING btree (tenant_id, platform);


--
-- Name: leads_user_id_dedupe_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX leads_user_id_dedupe_key_key ON public.leads USING btree (user_id, dedupe_key);


--
-- Name: leads_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_user_id_status_idx ON public.leads USING btree (user_id, status);


--
-- Name: local_engine_agent_confirmations_tenant_id_user_id_session__idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX local_engine_agent_confirmations_tenant_id_user_id_session__idx ON public.local_engine_agent_confirmations USING btree (tenant_id, user_id, session_id);


--
-- Name: local_engine_agent_confirmations_tenant_id_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX local_engine_agent_confirmations_tenant_id_user_id_status_idx ON public.local_engine_agent_confirmations USING btree (tenant_id, user_id, status);


--
-- Name: local_engine_agent_sessions_tenant_id_user_id_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX local_engine_agent_sessions_tenant_id_user_id_source_idx ON public.local_engine_agent_sessions USING btree (tenant_id, user_id, source);


--
-- Name: local_engine_agent_sessions_tenant_id_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX local_engine_agent_sessions_tenant_id_user_id_status_idx ON public.local_engine_agent_sessions USING btree (tenant_id, user_id, status);


--
-- Name: local_engine_agent_sessions_tenant_id_user_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX local_engine_agent_sessions_tenant_id_user_id_updated_at_idx ON public.local_engine_agent_sessions USING btree (tenant_id, user_id, updated_at);


--
-- Name: local_engine_agent_sessions_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX local_engine_agent_sessions_updated_at_idx ON public.local_engine_agent_sessions USING btree (updated_at);


--
-- Name: local_engine_reply_rules_tenant_id_user_id_bot_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX local_engine_reply_rules_tenant_id_user_id_bot_key_key ON public.local_engine_reply_rules USING btree (tenant_id, user_id, bot_key);


--
-- Name: local_engine_reply_rules_tenant_id_user_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX local_engine_reply_rules_tenant_id_user_id_updated_at_idx ON public.local_engine_reply_rules USING btree (tenant_id, user_id, updated_at);


--
-- Name: materials_collect_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_collect_date_idx ON public.materials USING btree (collect_date);


--
-- Name: materials_hasImage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "materials_hasImage_idx" ON public.materials USING btree ("hasImage");


--
-- Name: materials_owner_id_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_owner_id_platform_idx ON public.materials USING btree (owner_id, platform);


--
-- Name: materials_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_platform_idx ON public.materials USING btree (platform);


--
-- Name: materials_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX materials_status_idx ON public.materials USING btree (status);


--
-- Name: mobile_devices_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_devices_user_id_idx ON public.mobile_devices USING btree (user_id);


--
-- Name: offer_snapshots_master_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX offer_snapshots_master_id_idx ON public.offer_snapshots USING btree (master_id);


--
-- Name: offer_snapshots_vendor_code_platform_code_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX offer_snapshots_vendor_code_platform_code_item_id_idx ON public.offer_snapshots USING btree (vendor_code, platform_code, item_id);


--
-- Name: platform_identities_tenant_id_platform_account_id_external__key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_identities_tenant_id_platform_account_id_external__key ON public.platform_identities USING btree (tenant_id, platform, account_id, external_user_id);


--
-- Name: platform_identities_tenant_id_platform_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_identities_tenant_id_platform_account_id_idx ON public.platform_identities USING btree (tenant_id, platform, account_id);


--
-- Name: poi_stores_tenant_id_user_id_city_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX poi_stores_tenant_id_user_id_city_idx ON public.poi_stores USING btree (tenant_id, user_id, city);


--
-- Name: poi_stores_tenant_id_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX poi_stores_tenant_id_user_id_status_idx ON public.poi_stores USING btree (tenant_id, user_id, status);


--
-- Name: price_histories_item_id_platform_code_snapshot_at_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX price_histories_item_id_platform_code_snapshot_at_key ON public.price_histories USING btree (item_id, platform_code, snapshot_at);


--
-- Name: price_histories_item_id_snapshot_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_histories_item_id_snapshot_at_idx ON public.price_histories USING btree (item_id, snapshot_at);


--
-- Name: price_histories_tenant_id_user_id_snapshot_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_histories_tenant_id_user_id_snapshot_at_idx ON public.price_histories USING btree (tenant_id, user_id, snapshot_at);


--
-- Name: price_watches_tenant_id_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_watches_tenant_id_user_id_status_idx ON public.price_watches USING btree (tenant_id, user_id, status);


--
-- Name: procurement_lists_store_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procurement_lists_store_id_idx ON public.procurement_lists USING btree (store_id);


--
-- Name: procurement_lists_tenant_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procurement_lists_tenant_id_user_id_idx ON public.procurement_lists USING btree (tenant_id, user_id);


--
-- Name: product_masters_title_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_masters_title_key_key ON public.product_masters USING btree (title_key);


--
-- Name: publish_accounts_tenant_id_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_accounts_tenant_id_user_id_created_at_idx ON public.publish_accounts USING btree (tenant_id, user_id, created_at);


--
-- Name: publish_accounts_tenant_id_user_id_platform_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_accounts_tenant_id_user_id_platform_status_idx ON public.publish_accounts USING btree (tenant_id, user_id, platform, status);


--
-- Name: publish_jobs_tenant_id_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX publish_jobs_tenant_id_idempotency_key_key ON public.publish_jobs USING btree (tenant_id, idempotency_key);


--
-- Name: publish_jobs_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_jobs_tenant_id_status_idx ON public.publish_jobs USING btree (tenant_id, status);


--
-- Name: publish_receipts_tenant_id_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_receipts_tenant_id_job_id_idx ON public.publish_receipts USING btree (tenant_id, job_id);


--
-- Name: publish_records_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_records_account_id_idx ON public.publish_records USING btree (account_id);


--
-- Name: publish_records_article_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_records_article_id_idx ON public.publish_records USING btree (article_id);


--
-- Name: publish_records_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_records_status_idx ON public.publish_records USING btree (status);


--
-- Name: publish_records_tenant_id_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_records_tenant_id_user_id_created_at_idx ON public.publish_records USING btree (tenant_id, user_id, created_at);


--
-- Name: publish_records_tenant_id_user_id_durable_record_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_records_tenant_id_user_id_durable_record_id_idx ON public.publish_records USING btree (tenant_id, user_id, durable_record_id);


--
-- Name: push_subscriptions_endpoint_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX push_subscriptions_endpoint_key ON public.push_subscriptions USING btree (endpoint);


--
-- Name: push_subscriptions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_id_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: rebate_accounts_tenant_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rebate_accounts_tenant_id_user_id_key ON public.rebate_accounts USING btree (tenant_id, user_id);


--
-- Name: rebate_exchanges_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rebate_exchanges_idempotency_key_key ON public.rebate_exchanges USING btree (idempotency_key);


--
-- Name: rebate_exchanges_tenant_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rebate_exchanges_tenant_id_user_id_idx ON public.rebate_exchanges USING btree (tenant_id, user_id);


--
-- Name: rebate_ledgers_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rebate_ledgers_idempotency_key_key ON public.rebate_ledgers USING btree (idempotency_key);


--
-- Name: rebate_ledgers_tenant_id_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rebate_ledgers_tenant_id_user_id_created_at_idx ON public.rebate_ledgers USING btree (tenant_id, user_id, created_at);


--
-- Name: rebate_withdrawals_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rebate_withdrawals_idempotency_key_key ON public.rebate_withdrawals USING btree (idempotency_key);


--
-- Name: rebate_withdrawals_tenant_id_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rebate_withdrawals_tenant_id_user_id_status_idx ON public.rebate_withdrawals USING btree (tenant_id, user_id, status);


--
-- Name: redfox_call_logs_connection_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_call_logs_connection_id_idx ON public.redfox_call_logs USING btree (connection_id);


--
-- Name: redfox_call_logs_endpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_call_logs_endpoint_idx ON public.redfox_call_logs USING btree (endpoint);


--
-- Name: redfox_call_logs_request_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_call_logs_request_hash_idx ON public.redfox_call_logs USING btree (request_hash);


--
-- Name: redfox_call_logs_skill_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_call_logs_skill_code_idx ON public.redfox_call_logs USING btree (skill_code);


--
-- Name: redfox_call_logs_skill_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_call_logs_skill_id_idx ON public.redfox_call_logs USING btree (skill_id);


--
-- Name: redfox_call_logs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_call_logs_status_idx ON public.redfox_call_logs USING btree (status);


--
-- Name: redfox_call_logs_tenant_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_call_logs_tenant_id_started_at_idx ON public.redfox_call_logs USING btree (tenant_id, started_at);


--
-- Name: redfox_call_logs_user_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_call_logs_user_id_started_at_idx ON public.redfox_call_logs USING btree (user_id, started_at);


--
-- Name: redfox_connections_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_connections_status_idx ON public.redfox_connections USING btree (status);


--
-- Name: redfox_connections_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_connections_tenant_id_idx ON public.redfox_connections USING btree (tenant_id);


--
-- Name: redfox_connections_tenant_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redfox_connections_tenant_id_user_id_key ON public.redfox_connections USING btree (tenant_id, user_id);


--
-- Name: redfox_connections_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_connections_user_id_idx ON public.redfox_connections USING btree (user_id);


--
-- Name: redfox_interfaces_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redfox_interfaces_code_key ON public.redfox_interfaces USING btree (code);


--
-- Name: redfox_interfaces_interface_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redfox_interfaces_interface_no_key ON public.redfox_interfaces USING btree (interface_no);


--
-- Name: redfox_interfaces_path_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_interfaces_path_idx ON public.redfox_interfaces USING btree (path);


--
-- Name: redfox_interfaces_platform_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_interfaces_platform_code_idx ON public.redfox_interfaces USING btree (platform_code);


--
-- Name: redfox_interfaces_platform_code_path_method_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redfox_interfaces_platform_code_path_method_key ON public.redfox_interfaces USING btree (platform_code, path, method);


--
-- Name: redfox_interfaces_scenario_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_interfaces_scenario_idx ON public.redfox_interfaces USING btree (scenario);


--
-- Name: redfox_interfaces_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_interfaces_status_idx ON public.redfox_interfaces USING btree (status);


--
-- Name: redfox_interfaces_synced_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_interfaces_synced_at_idx ON public.redfox_interfaces USING btree (synced_at);


--
-- Name: redfox_skill_installs_scenario_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_skill_installs_scenario_idx ON public.redfox_skill_installs USING btree (scenario);


--
-- Name: redfox_skill_installs_skill_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_skill_installs_skill_id_idx ON public.redfox_skill_installs USING btree (skill_id);


--
-- Name: redfox_skill_installs_tenant_id_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_skill_installs_tenant_id_enabled_idx ON public.redfox_skill_installs USING btree (tenant_id, enabled);


--
-- Name: redfox_skill_installs_tenant_id_skill_id_scenario_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redfox_skill_installs_tenant_id_skill_id_scenario_key ON public.redfox_skill_installs USING btree (tenant_id, skill_id, scenario);


--
-- Name: redfox_skill_installs_user_id_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_skill_installs_user_id_enabled_idx ON public.redfox_skill_installs USING btree (user_id, enabled);


--
-- Name: redfox_skill_installs_user_id_skill_id_scenario_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redfox_skill_installs_user_id_skill_id_scenario_key ON public.redfox_skill_installs USING btree (user_id, skill_id, scenario);


--
-- Name: redfox_skills_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_skills_category_idx ON public.redfox_skills USING btree (category);


--
-- Name: redfox_skills_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redfox_skills_code_key ON public.redfox_skills USING btree (code);


--
-- Name: redfox_skills_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_skills_platform_idx ON public.redfox_skills USING btree (platform);


--
-- Name: redfox_skills_skill_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX redfox_skills_skill_no_key ON public.redfox_skills USING btree (skill_no);


--
-- Name: redfox_skills_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_skills_status_idx ON public.redfox_skills USING btree (status);


--
-- Name: redfox_skills_synced_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX redfox_skills_synced_at_idx ON public.redfox_skills USING btree (synced_at);


--
-- Name: review_runs_generated_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_runs_generated_from_idx ON public.review_runs USING btree (generated_from);


--
-- Name: review_runs_tenant_id_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_runs_tenant_id_user_id_created_at_idx ON public.review_runs USING btree (tenant_id, user_id, created_at);


--
-- Name: risk_policies_action_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX risk_policies_action_key ON public.risk_policies USING btree (action);


--
-- Name: rpa_evidence_execution_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rpa_evidence_execution_id_idx ON public.rpa_evidence USING btree (execution_id);


--
-- Name: rpa_evidence_execution_sha256_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rpa_evidence_execution_sha256_key ON public.rpa_evidence USING btree (execution_id, sha256);


--
-- Name: rpa_evidence_step_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rpa_evidence_step_id_idx ON public.rpa_evidence USING btree (step_id);


--
-- Name: rpa_evidence_user_id_captured_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rpa_evidence_user_id_captured_at_idx ON public.rpa_evidence USING btree (user_id, captured_at);


--
-- Name: rpa_execution_steps_execution_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rpa_execution_steps_execution_id_idx ON public.rpa_execution_steps USING btree (execution_id);


--
-- Name: rpa_execution_steps_execution_id_sequence_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rpa_execution_steps_execution_id_sequence_no_key ON public.rpa_execution_steps USING btree (execution_id, sequence_no);


--
-- Name: rpa_executions_active_account_tenant_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rpa_executions_active_account_tenant_unique ON public.rpa_executions USING btree (tenant_id, platform, account_id) WHERE ((status = ANY (ARRAY['running'::text, 'paused'::text, 'needs-human'::text])) AND (tenant_id IS NOT NULL));


--
-- Name: rpa_executions_active_account_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rpa_executions_active_account_unique ON public.rpa_executions USING btree (user_id, platform, account_id) WHERE (status = ANY (ARRAY['running'::text, 'paused'::text, 'needs-human'::text]));


--
-- Name: rpa_executions_platform_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rpa_executions_platform_status_idx ON public.rpa_executions USING btree (platform, status);


--
-- Name: rpa_executions_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rpa_executions_run_id_idx ON public.rpa_executions USING btree (run_id);


--
-- Name: rpa_executions_tenant_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rpa_executions_tenant_id_started_at_idx ON public.rpa_executions USING btree (tenant_id, started_at);


--
-- Name: rpa_executions_user_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rpa_executions_user_id_started_at_idx ON public.rpa_executions USING btree (user_id, started_at);


--
-- Name: runtime_executions_accountId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "runtime_executions_accountId_idx" ON public.runtime_executions USING btree ("accountId");


--
-- Name: runtime_executions_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "runtime_executions_createdAt_idx" ON public.runtime_executions USING btree ("createdAt");


--
-- Name: runtime_executions_durable_publish_related_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX runtime_executions_durable_publish_related_id_key ON public.runtime_executions USING btree (tenant_id, user_id, "relatedId") WHERE ("taskType" = 'auto-upload-publish-record-v1'::text);


--
-- Name: runtime_executions_executor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_executions_executor_idx ON public.runtime_executions USING btree (executor);


--
-- Name: runtime_executions_relatedId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "runtime_executions_relatedId_idx" ON public.runtime_executions USING btree ("relatedId");


--
-- Name: runtime_executions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_executions_status_idx ON public.runtime_executions USING btree (status);


--
-- Name: runtime_executions_taskType_status_lease_expires_at_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "runtime_executions_taskType_status_lease_expires_at_created_idx" ON public.runtime_executions USING btree ("taskType", status, lease_expires_at, "createdAt");


--
-- Name: runtime_executions_tenant_id_user_id_taskType_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "runtime_executions_tenant_id_user_id_taskType_createdAt_idx" ON public.runtime_executions USING btree (tenant_id, user_id, "taskType", "createdAt");


--
-- Name: runtime_executions_tenant_user_task_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX runtime_executions_tenant_user_task_idempotency_key ON public.runtime_executions USING btree (tenant_id, user_id, "taskType", idempotency_key);


--
-- Name: savings_checkins_tenant_id_user_id_checkin_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX savings_checkins_tenant_id_user_id_checkin_date_idx ON public.savings_checkins USING btree (tenant_id, user_id, checkin_date);


--
-- Name: savings_checkins_tenant_id_user_id_checkin_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX savings_checkins_tenant_id_user_id_checkin_date_key ON public.savings_checkins USING btree (tenant_id, user_id, checkin_date);


--
-- Name: schedule_configs_user_id_task_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX schedule_configs_user_id_task_type_key ON public.schedule_configs USING btree (user_id, task_type);


--
-- Name: showcase_authorizations_case_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_authorizations_case_id_idx ON public.showcase_authorizations USING btree (case_id);


--
-- Name: showcase_authorizations_review_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_authorizations_review_status_idx ON public.showcase_authorizations USING btree (review_status);


--
-- Name: showcase_case_reviews_case_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_case_reviews_case_id_created_at_idx ON public.showcase_case_reviews USING btree (case_id, created_at);


--
-- Name: showcase_case_reviews_decision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_case_reviews_decision_idx ON public.showcase_case_reviews USING btree (decision);


--
-- Name: showcase_cases_provenance_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_cases_provenance_type_idx ON public.showcase_cases USING btree (provenance_type);


--
-- Name: showcase_cases_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_cases_published_at_idx ON public.showcase_cases USING btree (published_at);


--
-- Name: showcase_cases_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX showcase_cases_slug_key ON public.showcase_cases USING btree (slug);


--
-- Name: showcase_cases_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_cases_status_idx ON public.showcase_cases USING btree (status);


--
-- Name: showcase_collection_items_case_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_collection_items_case_id_idx ON public.showcase_collection_items USING btree (case_id);


--
-- Name: showcase_collections_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX showcase_collections_slug_key ON public.showcase_collections USING btree (slug);


--
-- Name: showcase_collections_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_collections_status_idx ON public.showcase_collections USING btree (status);


--
-- Name: showcase_demo_endpoints_case_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_demo_endpoints_case_id_idx ON public.showcase_demo_endpoints USING btree (case_id);


--
-- Name: showcase_demo_endpoints_short_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_demo_endpoints_short_code_idx ON public.showcase_demo_endpoints USING btree (short_code);


--
-- Name: showcase_media_case_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_media_case_id_sort_order_idx ON public.showcase_media USING btree (case_id, sort_order);


--
-- Name: showcase_short_links_short_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX showcase_short_links_short_code_key ON public.showcase_short_links USING btree (short_code);


--
-- Name: showcase_short_links_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_short_links_status_idx ON public.showcase_short_links USING btree (status);


--
-- Name: showcase_short_links_target_type_target_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_short_links_target_type_target_id_idx ON public.showcase_short_links USING btree (target_type, target_id);


--
-- Name: showcase_tag_aliases_alias_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX showcase_tag_aliases_alias_key ON public.showcase_tag_aliases USING btree (alias);


--
-- Name: showcase_tag_aliases_canonical_taxonomy_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_tag_aliases_canonical_taxonomy_id_idx ON public.showcase_tag_aliases USING btree (canonical_taxonomy_id);


--
-- Name: showcase_taxonomies_type_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX showcase_taxonomies_type_enabled_idx ON public.showcase_taxonomies USING btree (type, enabled);


--
-- Name: showcase_taxonomies_type_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX showcase_taxonomies_type_slug_key ON public.showcase_taxonomies USING btree (type, slug);


--
-- Name: solution_artifacts_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_artifacts_created_at_idx ON public.solution_artifacts USING btree (created_at);


--
-- Name: solution_artifacts_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_artifacts_kind_idx ON public.solution_artifacts USING btree (kind);


--
-- Name: solution_artifacts_result_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_artifacts_result_id_idx ON public.solution_artifacts USING btree (result_id);


--
-- Name: solution_artifacts_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_artifacts_run_id_idx ON public.solution_artifacts USING btree (run_id);


--
-- Name: solution_artifacts_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_artifacts_task_id_idx ON public.solution_artifacts USING btree (task_id);


--
-- Name: solution_cost_entries_billing_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_billing_status_idx ON public.solution_cost_entries USING btree (billing_status);


--
-- Name: solution_cost_entries_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_created_at_idx ON public.solution_cost_entries USING btree (created_at);


--
-- Name: solution_cost_entries_endpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_endpoint_idx ON public.solution_cost_entries USING btree (endpoint);


--
-- Name: solution_cost_entries_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_idempotency_key_idx ON public.solution_cost_entries USING btree (idempotency_key);


--
-- Name: solution_cost_entries_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_provider_idx ON public.solution_cost_entries USING btree (provider);


--
-- Name: solution_cost_entries_redfox_call_log_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_redfox_call_log_id_idx ON public.solution_cost_entries USING btree (redfox_call_log_id);


--
-- Name: solution_cost_entries_request_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_request_hash_idx ON public.solution_cost_entries USING btree (request_hash);


--
-- Name: solution_cost_entries_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_run_id_idx ON public.solution_cost_entries USING btree (run_id);


--
-- Name: solution_cost_entries_runtime_execution_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_runtime_execution_id_idx ON public.solution_cost_entries USING btree (runtime_execution_id);


--
-- Name: solution_cost_entries_skill_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_skill_code_idx ON public.solution_cost_entries USING btree (skill_code);


--
-- Name: solution_cost_entries_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_cost_entries_task_id_idx ON public.solution_cost_entries USING btree (task_id);


--
-- Name: solution_results_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_results_created_at_idx ON public.solution_results USING btree (created_at);


--
-- Name: solution_results_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_results_kind_idx ON public.solution_results USING btree (kind);


--
-- Name: solution_results_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_results_run_id_idx ON public.solution_results USING btree (run_id);


--
-- Name: solution_results_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_results_status_idx ON public.solution_results USING btree (status);


--
-- Name: solution_results_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_results_task_id_idx ON public.solution_results USING btree (task_id);


--
-- Name: solution_runs_correlation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_runs_correlation_id_idx ON public.solution_runs USING btree (correlation_id);


--
-- Name: solution_runs_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_runs_idempotency_key_idx ON public.solution_runs USING btree (idempotency_key);


--
-- Name: solution_runs_package_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_runs_package_code_idx ON public.solution_runs USING btree (package_code);


--
-- Name: solution_runs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_runs_status_idx ON public.solution_runs USING btree (status);


--
-- Name: solution_runs_tenant_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_runs_tenant_id_created_at_idx ON public.solution_runs USING btree (tenant_id, created_at);


--
-- Name: solution_runs_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_runs_tenant_id_status_idx ON public.solution_runs USING btree (tenant_id, status);


--
-- Name: solution_runs_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_runs_user_id_created_at_idx ON public.solution_runs USING btree (user_id, created_at);


--
-- Name: solution_tasks_agent_confirmation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_tasks_agent_confirmation_id_idx ON public.solution_tasks USING btree (agent_confirmation_id);


--
-- Name: solution_tasks_dedupe_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_tasks_dedupe_key_idx ON public.solution_tasks USING btree (dedupe_key);


--
-- Name: solution_tasks_executor_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_tasks_executor_kind_idx ON public.solution_tasks USING btree (executor_kind);


--
-- Name: solution_tasks_interaction_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_tasks_interaction_task_id_idx ON public.solution_tasks USING btree (interaction_task_id);


--
-- Name: solution_tasks_redfox_call_log_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_tasks_redfox_call_log_id_idx ON public.solution_tasks USING btree (redfox_call_log_id);


--
-- Name: solution_tasks_request_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_tasks_request_hash_idx ON public.solution_tasks USING btree (request_hash);


--
-- Name: solution_tasks_run_id_order_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX solution_tasks_run_id_order_key ON public.solution_tasks USING btree (run_id, "order");


--
-- Name: solution_tasks_run_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_tasks_run_id_status_idx ON public.solution_tasks USING btree (run_id, status);


--
-- Name: solution_tasks_runtime_execution_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_tasks_runtime_execution_id_idx ON public.solution_tasks USING btree (runtime_execution_id);


--
-- Name: solution_tasks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solution_tasks_status_idx ON public.solution_tasks USING btree (status);


--
-- Name: source_contents_author_identity_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_contents_author_identity_id_idx ON public.source_contents USING btree (author_identity_id);


--
-- Name: source_contents_tenant_id_platform_account_id_collected_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_contents_tenant_id_platform_account_id_collected_at_idx ON public.source_contents USING btree (tenant_id, platform, account_id, collected_at);


--
-- Name: source_contents_tenant_id_platform_account_id_external_cont_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX source_contents_tenant_id_platform_account_id_external_cont_key ON public.source_contents USING btree (tenant_id, platform, account_id, external_content_id);


--
-- Name: sources_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sources_enabled_idx ON public.sources USING btree (enabled);


--
-- Name: stores_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stores_tenant_id_status_idx ON public.stores USING btree (tenant_id, status);


--
-- Name: styles_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX styles_name_key ON public.styles USING btree (name);


--
-- Name: styles_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX styles_type_idx ON public.styles USING btree (type);


--
-- Name: suppressions_tenant_id_kind_normalized_value_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppressions_tenant_id_kind_normalized_value_idx ON public.suppressions USING btree (tenant_id, kind, normalized_value);


--
-- Name: suppressions_tenant_id_kind_normalized_value_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX suppressions_tenant_id_kind_normalized_value_key ON public.suppressions USING btree (tenant_id, kind, normalized_value);


--
-- Name: system_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_logs_created_at_idx ON public.system_logs USING btree (created_at);


--
-- Name: system_logs_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_logs_level_idx ON public.system_logs USING btree (level);


--
-- Name: tenant_entitlements_period_end_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_entitlements_period_end_idx ON public.tenant_entitlements USING btree (period_end);


--
-- Name: tenant_entitlements_plan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_entitlements_plan_idx ON public.tenant_entitlements USING btree (plan);


--
-- Name: tenant_entitlements_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_entitlements_source_idx ON public.tenant_entitlements USING btree (source);


--
-- Name: tenant_entitlements_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_entitlements_status_idx ON public.tenant_entitlements USING btree (status);


--
-- Name: tenant_entitlements_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_entitlements_tenant_id_idx ON public.tenant_entitlements USING btree (tenant_id);


--
-- Name: tenant_entitlements_tenant_id_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_entitlements_tenant_id_source_key ON public.tenant_entitlements USING btree (tenant_id, source);


--
-- Name: tenant_members_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_members_role_idx ON public.tenant_members USING btree (role);


--
-- Name: tenant_members_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_members_status_idx ON public.tenant_members USING btree (status);


--
-- Name: tenant_members_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_members_tenant_id_idx ON public.tenant_members USING btree (tenant_id);


--
-- Name: tenant_members_tenant_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_members_tenant_id_user_id_key ON public.tenant_members USING btree (tenant_id, user_id);


--
-- Name: tenant_members_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_members_user_id_idx ON public.tenant_members USING btree (user_id);


--
-- Name: tenants_owner_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenants_owner_user_id_idx ON public.tenants USING btree (owner_user_id);


--
-- Name: tenants_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenants_slug_key ON public.tenants USING btree (slug);


--
-- Name: tenants_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenants_status_idx ON public.tenants USING btree (status);


--
-- Name: topics_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX topics_created_at_idx ON public.topics USING btree (created_at);


--
-- Name: topics_is_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX topics_is_published_idx ON public.topics USING btree (is_published);


--
-- Name: topics_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX topics_status_idx ON public.topics USING btree (status);


--
-- Name: user_memories_user_id_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_memories_user_id_priority_idx ON public.user_memories USING btree (user_id, priority);


--
-- Name: user_memories_user_id_type_content_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_memories_user_id_type_content_key ON public.user_memories USING btree (user_id, type, content);


--
-- Name: user_memories_user_id_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_memories_user_id_type_idx ON public.user_memories USING btree (user_id, type);


--
-- Name: user_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sessions_expires_at_idx ON public.user_sessions USING btree (expires_at);


--
-- Name: user_sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sessions_user_id_idx ON public.user_sessions USING btree (user_id);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: users_kaypal_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_kaypal_user_id_idx ON public.users USING btree (kaypal_user_id);


--
-- Name: users_kaypal_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_kaypal_user_id_key ON public.users USING btree (kaypal_user_id);


--
-- Name: users_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_role_idx ON public.users USING btree (role);


--
-- Name: users_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_status_idx ON public.users USING btree (status);


--
-- Name: users_username_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_username_key ON public.users USING btree (username);


--
-- Name: wechat_pay_orders_out_trade_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wechat_pay_orders_out_trade_no_key ON public.wechat_pay_orders USING btree (out_trade_no);


--
-- Name: wechat_pay_orders_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wechat_pay_orders_status_idx ON public.wechat_pay_orders USING btree (status);


--
-- Name: wechat_pay_orders_tenant_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wechat_pay_orders_tenant_id_user_id_idx ON public.wechat_pay_orders USING btree (tenant_id, user_id);


--
-- Name: wechat_pay_orders_transaction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wechat_pay_orders_transaction_id_idx ON public.wechat_pay_orders USING btree (transaction_id);


--
-- Name: wecom_assistant_integrations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_assistant_integrations_status_idx ON public.wecom_assistant_integrations USING btree (status);


--
-- Name: wecom_assistant_integrations_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_assistant_integrations_updated_at_idx ON public.wecom_assistant_integrations USING btree (updated_at);


--
-- Name: wecom_assistant_integrations_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_assistant_integrations_user_id_idx ON public.wecom_assistant_integrations USING btree (user_id);


--
-- Name: wecom_assistant_settings_integration_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wecom_assistant_settings_integration_id_key ON public.wecom_assistant_settings USING btree (integration_id);


--
-- Name: wecom_assistant_settings_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_assistant_settings_user_id_idx ON public.wecom_assistant_settings USING btree (user_id);


--
-- Name: wecom_contacts_config_id_external_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wecom_contacts_config_id_external_user_id_key ON public.wecom_contacts USING btree (config_id, external_user_id);


--
-- Name: wecom_contacts_config_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_contacts_config_id_idx ON public.wecom_contacts USING btree (config_id);


--
-- Name: wecom_corp_configs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_corp_configs_status_idx ON public.wecom_corp_configs USING btree (status);


--
-- Name: wecom_corp_configs_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_corp_configs_user_id_idx ON public.wecom_corp_configs USING btree (user_id);


--
-- Name: wecom_group_msg_tasks_config_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_group_msg_tasks_config_id_idx ON public.wecom_group_msg_tasks USING btree (config_id);


--
-- Name: wecom_group_msg_tasks_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_group_msg_tasks_user_id_idx ON public.wecom_group_msg_tasks USING btree (user_id);


--
-- Name: wecom_group_msg_tasks_wecom_msg_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_group_msg_tasks_wecom_msg_id_idx ON public.wecom_group_msg_tasks USING btree (wecom_msg_id);


--
-- Name: wecom_moment_tasks_config_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_moment_tasks_config_id_idx ON public.wecom_moment_tasks USING btree (config_id);


--
-- Name: wecom_moment_tasks_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_moment_tasks_user_id_idx ON public.wecom_moment_tasks USING btree (user_id);


--
-- Name: wecom_moment_tasks_wecom_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_moment_tasks_wecom_job_id_idx ON public.wecom_moment_tasks USING btree (wecom_job_id);


--
-- Name: wecom_outbound_messages_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_outbound_messages_created_at_idx ON public.wecom_outbound_messages USING btree (created_at);


--
-- Name: wecom_outbound_messages_integration_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_outbound_messages_integration_id_idx ON public.wecom_outbound_messages USING btree (integration_id);


--
-- Name: wecom_outbound_messages_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_outbound_messages_status_idx ON public.wecom_outbound_messages USING btree (status);


--
-- Name: wecom_outbound_messages_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wecom_outbound_messages_user_id_idx ON public.wecom_outbound_messages USING btree (user_id);


--
-- Name: ai_models ai_models_platform_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_models
    ADD CONSTRAINT ai_models_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.ai_platforms(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: app_install_states app_install_states_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_install_states
    ADD CONSTRAINT app_install_states_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: articles articles_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.ai_models(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: articles articles_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.articles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: articles articles_style_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_style_id_fkey FOREIGN KEY (style_id) REFERENCES public.styles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: articles articles_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.styles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: articles articles_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: benchmark_accounts benchmark_accounts_growth_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmark_accounts
    ADD CONSTRAINT benchmark_accounts_growth_lead_id_fkey FOREIGN KEY (growth_lead_id) REFERENCES public.growth_leads(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: benchmark_accounts benchmark_accounts_intelligence_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmark_accounts
    ADD CONSTRAINT benchmark_accounts_intelligence_item_id_fkey FOREIGN KEY (intelligence_item_id) REFERENCES public.intelligence_items(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: benchmark_accounts benchmark_accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmark_accounts
    ADD CONSTRAINT benchmark_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: benchmark_accounts benchmark_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmark_accounts
    ADD CONSTRAINT benchmark_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: billing_invoices billing_invoices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: billing_subscriptions billing_subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: billing_webhook_events billing_webhook_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: brand_knowledge brand_knowledge_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_knowledge
    ADD CONSTRAINT brand_knowledge_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: comment_insights comment_insights_growth_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_insights
    ADD CONSTRAINT comment_insights_growth_lead_id_fkey FOREIGN KEY (growth_lead_id) REFERENCES public.growth_leads(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: comment_insights comment_insights_intelligence_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_insights
    ADD CONSTRAINT comment_insights_intelligence_item_id_fkey FOREIGN KEY (intelligence_item_id) REFERENCES public.intelligence_items(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: comment_insights comment_insights_redfox_call_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_insights
    ADD CONSTRAINT comment_insights_redfox_call_log_id_fkey FOREIGN KEY (redfox_call_log_id) REFERENCES public.redfox_call_logs(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: comment_insights comment_insights_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_insights
    ADD CONSTRAINT comment_insights_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: comment_insights comment_insights_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_insights
    ADD CONSTRAINT comment_insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: compliance_checks compliance_checks_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_checks
    ADD CONSTRAINT compliance_checks_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: compliance_checks compliance_checks_redfox_call_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_checks
    ADD CONSTRAINT compliance_checks_redfox_call_log_id_fkey FOREIGN KEY (redfox_call_log_id) REFERENCES public.redfox_call_logs(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: compliance_checks compliance_checks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_checks
    ADD CONSTRAINT compliance_checks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: compliance_checks compliance_checks_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_checks
    ADD CONSTRAINT compliance_checks_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: compliance_checks compliance_checks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_checks
    ADD CONSTRAINT compliance_checks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: content_variants content_variants_content_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_variants
    ADD CONSTRAINT content_variants_content_unit_id_fkey FOREIGN KEY (content_unit_id) REFERENCES public.articles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crm_audit_events crm_audit_events_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_audit_events
    ADD CONSTRAINT crm_audit_events_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.crm_import_batches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_audit_events crm_audit_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_audit_events
    ADD CONSTRAINT crm_audit_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crm_companies crm_companies_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_companies
    ADD CONSTRAINT crm_companies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crm_customers crm_customers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_customers
    ADD CONSTRAINT crm_customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_customers crm_customers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_customers
    ADD CONSTRAINT crm_customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crm_import_batches crm_import_batches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_import_batches
    ADD CONSTRAINT crm_import_batches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crm_notes crm_notes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_notes crm_notes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.crm_customers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_notes crm_notes_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_notes crm_notes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crm_opportunities crm_opportunities_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_opportunities crm_opportunities_primary_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_primary_customer_id_fkey FOREIGN KEY (primary_customer_id) REFERENCES public.crm_customers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_opportunities crm_opportunities_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_tasks crm_tasks_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.crm_customers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_tasks crm_tasks_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_tasks crm_tasks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crm_timeline_events crm_timeline_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_timeline_events
    ADD CONSTRAINT crm_timeline_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.crm_companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_timeline_events crm_timeline_events_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_timeline_events
    ADD CONSTRAINT crm_timeline_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.crm_customers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_timeline_events crm_timeline_events_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_timeline_events
    ADD CONSTRAINT crm_timeline_events_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.crm_notes(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_timeline_events crm_timeline_events_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_timeline_events
    ADD CONSTRAINT crm_timeline_events_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_timeline_events crm_timeline_events_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_timeline_events
    ADD CONSTRAINT crm_timeline_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.crm_tasks(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: crm_timeline_events crm_timeline_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_timeline_events
    ADD CONSTRAINT crm_timeline_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: growth_account_health_snapshots growth_account_health_snapshots_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_account_health_snapshots
    ADD CONSTRAINT growth_account_health_snapshots_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: growth_account_health growth_account_health_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_account_health
    ADD CONSTRAINT growth_account_health_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: growth_acquisition_configs growth_acquisition_configs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_acquisition_configs
    ADD CONSTRAINT growth_acquisition_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: growth_acquisition_runs growth_acquisition_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_acquisition_runs
    ADD CONSTRAINT growth_acquisition_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: growth_leads growth_leads_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_leads
    ADD CONSTRAINT growth_leads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: growth_scheduler_leases growth_scheduler_leases_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_scheduler_leases
    ADD CONSTRAINT growth_scheduler_leases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: growth_strategies growth_strategies_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_strategies
    ADD CONSTRAINT growth_strategies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: growth_workflows growth_workflows_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_workflows
    ADD CONSTRAINT growth_workflows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: intelligence_items intelligence_items_growth_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_items
    ADD CONSTRAINT intelligence_items_growth_lead_id_fkey FOREIGN KEY (growth_lead_id) REFERENCES public.growth_leads(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: intelligence_items intelligence_items_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_items
    ADD CONSTRAINT intelligence_items_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: intelligence_items intelligence_items_redfox_call_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_items
    ADD CONSTRAINT intelligence_items_redfox_call_log_id_fkey FOREIGN KEY (redfox_call_log_id) REFERENCES public.redfox_call_logs(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: intelligence_items intelligence_items_redfox_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_items
    ADD CONSTRAINT intelligence_items_redfox_skill_id_fkey FOREIGN KEY (redfox_skill_id) REFERENCES public.redfox_skills(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: intelligence_items intelligence_items_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_items
    ADD CONSTRAINT intelligence_items_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sources(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: intelligence_items intelligence_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_items
    ADD CONSTRAINT intelligence_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: intelligence_items intelligence_items_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_items
    ADD CONSTRAINT intelligence_items_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: intelligence_items intelligence_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_items
    ADD CONSTRAINT intelligence_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: intelligence_monitors intelligence_monitors_skill_install_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_monitors
    ADD CONSTRAINT intelligence_monitors_skill_install_id_fkey FOREIGN KEY (skill_install_id) REFERENCES public.redfox_skill_installs(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: intelligence_monitors intelligence_monitors_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_monitors
    ADD CONSTRAINT intelligence_monitors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: intelligence_monitors intelligence_monitors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_monitors
    ADD CONSTRAINT intelligence_monitors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: intelligence_reports intelligence_reports_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_reports
    ADD CONSTRAINT intelligence_reports_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: intelligence_reports intelligence_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_reports
    ADD CONSTRAINT intelligence_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: interaction_events interaction_events_content_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_content_id_fkey FOREIGN KEY (content_id) REFERENCES public.source_contents(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: interaction_events interaction_events_identity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.platform_identities(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: leads leads_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.crm_customers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: leads leads_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: publish_jobs publish_jobs_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_jobs
    ADD CONSTRAINT publish_jobs_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.content_variants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: publish_receipts publish_receipts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_receipts
    ADD CONSTRAINT publish_receipts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.publish_jobs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: publish_records publish_records_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_records
    ADD CONSTRAINT publish_records_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.publish_accounts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: publish_records publish_records_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_records
    ADD CONSTRAINT publish_records_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: redfox_call_logs redfox_call_logs_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_call_logs
    ADD CONSTRAINT redfox_call_logs_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.redfox_connections(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: redfox_call_logs redfox_call_logs_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_call_logs
    ADD CONSTRAINT redfox_call_logs_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.redfox_skills(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: redfox_call_logs redfox_call_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_call_logs
    ADD CONSTRAINT redfox_call_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: redfox_call_logs redfox_call_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_call_logs
    ADD CONSTRAINT redfox_call_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: redfox_connections redfox_connections_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_connections
    ADD CONSTRAINT redfox_connections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: redfox_connections redfox_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_connections
    ADD CONSTRAINT redfox_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: redfox_skill_installs redfox_skill_installs_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_skill_installs
    ADD CONSTRAINT redfox_skill_installs_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.redfox_skills(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: redfox_skill_installs redfox_skill_installs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_skill_installs
    ADD CONSTRAINT redfox_skill_installs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: redfox_skill_installs redfox_skill_installs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.redfox_skill_installs
    ADD CONSTRAINT redfox_skill_installs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rpa_evidence rpa_evidence_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpa_evidence
    ADD CONSTRAINT rpa_evidence_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES public.rpa_executions(id) ON DELETE CASCADE;


--
-- Name: rpa_evidence rpa_evidence_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpa_evidence
    ADD CONSTRAINT rpa_evidence_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.rpa_execution_steps(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: rpa_execution_steps rpa_execution_steps_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpa_execution_steps
    ADD CONSTRAINT rpa_execution_steps_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES public.rpa_executions(id) ON DELETE CASCADE;


--
-- Name: showcase_authorizations showcase_authorizations_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_authorizations
    ADD CONSTRAINT showcase_authorizations_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.showcase_cases(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: showcase_case_reviews showcase_case_reviews_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_case_reviews
    ADD CONSTRAINT showcase_case_reviews_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.showcase_cases(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: showcase_collection_items showcase_collection_items_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_collection_items
    ADD CONSTRAINT showcase_collection_items_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.showcase_cases(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: showcase_collection_items showcase_collection_items_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_collection_items
    ADD CONSTRAINT showcase_collection_items_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.showcase_collections(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: showcase_demo_endpoints showcase_demo_endpoints_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_demo_endpoints
    ADD CONSTRAINT showcase_demo_endpoints_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.showcase_cases(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: showcase_media showcase_media_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_media
    ADD CONSTRAINT showcase_media_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.showcase_cases(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: showcase_short_links showcase_short_links_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_short_links
    ADD CONSTRAINT showcase_short_links_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.showcase_cases(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: showcase_tag_aliases showcase_tag_aliases_canonical_taxonomy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.showcase_tag_aliases
    ADD CONSTRAINT showcase_tag_aliases_canonical_taxonomy_id_fkey FOREIGN KEY (canonical_taxonomy_id) REFERENCES public.showcase_taxonomies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: solution_artifacts solution_artifacts_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_artifacts
    ADD CONSTRAINT solution_artifacts_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.solution_results(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: solution_artifacts solution_artifacts_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_artifacts
    ADD CONSTRAINT solution_artifacts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.solution_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: solution_artifacts solution_artifacts_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_artifacts
    ADD CONSTRAINT solution_artifacts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.solution_tasks(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: solution_cost_entries solution_cost_entries_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_cost_entries
    ADD CONSTRAINT solution_cost_entries_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.solution_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: solution_cost_entries solution_cost_entries_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_cost_entries
    ADD CONSTRAINT solution_cost_entries_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.solution_tasks(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: solution_results solution_results_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_results
    ADD CONSTRAINT solution_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.solution_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: solution_results solution_results_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_results
    ADD CONSTRAINT solution_results_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.solution_tasks(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: solution_runs solution_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_runs
    ADD CONSTRAINT solution_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: solution_runs solution_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_runs
    ADD CONSTRAINT solution_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: solution_tasks solution_tasks_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solution_tasks
    ADD CONSTRAINT solution_tasks_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.solution_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: source_contents source_contents_author_identity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_contents
    ADD CONSTRAINT source_contents_author_identity_id_fkey FOREIGN KEY (author_identity_id) REFERENCES public.platform_identities(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: tenant_entitlements tenant_entitlements_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_entitlements
    ADD CONSTRAINT tenant_entitlements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tenant_members tenant_members_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tenant_members tenant_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tenants tenants_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: topic_materials topic_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_materials
    ADD CONSTRAINT topic_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: topic_materials topic_materials_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_materials
    ADD CONSTRAINT topic_materials_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: wecom_assistant_settings wecom_assistant_settings_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_assistant_settings
    ADD CONSTRAINT wecom_assistant_settings_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.wecom_assistant_integrations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: wecom_contacts wecom_contacts_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_contacts
    ADD CONSTRAINT wecom_contacts_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.wecom_corp_configs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: wecom_group_msg_tasks wecom_group_msg_tasks_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_group_msg_tasks
    ADD CONSTRAINT wecom_group_msg_tasks_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.wecom_corp_configs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: wecom_moment_tasks wecom_moment_tasks_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_moment_tasks
    ADD CONSTRAINT wecom_moment_tasks_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.wecom_corp_configs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: wecom_outbound_messages wecom_outbound_messages_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wecom_outbound_messages
    ADD CONSTRAINT wecom_outbound_messages_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.wecom_assistant_integrations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict bE7vXT7aP9HO95QDfyKBgHx2Gt8ksJ335bYCFlTdvl78fhzcFh4LgjSg0fd3r3U

