#!/usr/bin/env python3
"""
阶段 2 存量迁移脚本：三套旧线索数据 → 统一 leads 表（SQLite 桌面版）。

- growth_leads → leads（字段一一映射，crm_customer_id → customer_id）
- comment_acquisition_leads → leads（comment_text→source_text 等，source_type='comment'）
- crm_customers 回填 lead_id（按 dedupeKey 匹配已迁 Lead，打通追溯链）

幂等：可重复执行，已迁移的（dedupeKey 已存在）跳过。
去重：dedupeKey 与 LeadRepository.dedupeKeyOf 算法一致（lead:sha256(platform+identity)）。

用法：
  python3 scripts/migrate-leads-sqlite.py --db <sqlite路径> [--dry-run]
"""

import argparse
import hashlib
import sqlite3
import sys


def dedupe_key(platform, external_user_id, nickname, source_text):
    identity = (
        f"uid:{external_user_id}"
        if external_user_id
        else f"nick:{nickname or ''}|{(source_text or '')[:40]}"
    )
    return "lead:" + hashlib.sha256(f"{platform}:{identity}".encode()).hexdigest()


LEAD_COLS = [
    "id", "user_id", "tenant_id", "platform", "source_type",
    "source_task_id", "source_run_id", "source_url", "source_text",
    "external_user_id", "dedupe_key", "nickname", "profile_url", "avatar_url",
    "score", "score_reasons", "matched_keywords", "signals",
    "latest_reply", "reply_persona_id", "replied_at", "status", "customer_id",
    "evidence_urls", "owner_user_id", "next_follow_up_at",
    "created_at", "updated_at",
]


def migrate_growth_leads(cur, db, dry_run):
    """growth_leads → leads"""
    cur.execute("SELECT * FROM growth_leads")
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    migrated = 0
    skipped = 0
    for row in rows:
        r = dict(zip(cols, row))
        key = dedupe_key(
            r.get("platform"), r.get("external_user_id"),
            r.get("nickname"), r.get("source_text"),
        )
        # 已存在则跳过（幂等 + 去重）
        cur.execute("SELECT id FROM leads WHERE dedupe_key = ?", (key,))
        if cur.fetchone():
            skipped += 1
            continue
        migrated += 1
        if dry_run:
            continue
        cur.execute(
            f"""INSERT INTO leads ({",".join(LEAD_COLS)}) VALUES ({",".join("?" * len(LEAD_COLS))})""",
            (
                r.get("id"), r.get("user_id"), r.get("tenant_id"),
                r.get("platform"), r.get("source_type"),
                r.get("source_task_id"), r.get("source_run_id"),
                r.get("source_url"), r.get("source_text"),
                r.get("external_user_id"), key,
                r.get("nickname"), r.get("profile_url"), r.get("avatar_url"),
                r.get("score") or 0, r.get("score_reasons") or "[]",
                r.get("matched_keywords") or "[]", "[]",  # signals 无来源，空
                r.get("latest_reply"), None, None,  # reply_persona_id/replied_at 无
                r.get("status") or "pending", r.get("crm_customer_id"),  # 关键：customer_id
                r.get("evidence_urls") or "[]", r.get("owner_user_id"),
                r.get("next_follow_up_at"),
                r.get("created_at"), r.get("updated_at"),
            ),
        )
    print(f"  growth_leads: 迁移 {migrated} 条, 跳过 {skipped} 条（dedupeKey 已存在）")
    return migrated


def migrate_comment_leads(cur, dry_run):
    """comment_acquisition_leads → leads"""
    cur.execute("SELECT * FROM comment_acquisition_leads")
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    migrated = 0
    skipped = 0
    for row in rows:
        r = dict(zip(cols, row))
        key = dedupe_key(
            r.get("platform"), None,
            r.get("commenter_name"), r.get("comment_text"),
        )
        cur.execute("SELECT id FROM leads WHERE dedupe_key = ?", (key,))
        if cur.fetchone():
            skipped += 1
            continue
        migrated += 1
        if dry_run:
            continue
        cur.execute(
            f"""INSERT INTO leads ({",".join(LEAD_COLS)}) VALUES ({",".join("?" * len(LEAD_COLS))})""",
            (
                r.get("id"), r.get("user_id"), r.get("tenant_id"),
                r.get("platform"), "comment",  # source_type 默认 comment
                None, None,  # source_task_id/source_run_id 无
                None, r.get("comment_text"),  # source_url 无, source_text=comment_text
                None, key,  # external_user_id 无
                r.get("commenter_name"), None, None,  # nickname/profile_url/avatar_url
                r.get("lead_score") or 0, "[]", "[]", r.get("signals") or "[]",
                r.get("reply_text"), r.get("persona_id"), None,
                r.get("status") or "pending", None,
                "[]", None, None,
                r.get("created_at"), r.get("updated_at"),
            ),
        )
    print(f"  comment_acquisition_leads: 迁移 {migrated} 条, 跳过 {skipped} 条")
    return migrated


def backfill_customer_lead(cur, dry_run):
    """crm_customers 回填 lead_id（按 dedupeKey 匹配已迁 Lead）"""
    cur.execute("SELECT id, tenant_id, owner_id, dedupe_key, external_user_id FROM crm_customers")
    rows = cur.fetchall()
    linked = 0
    for cid, tenant_id, owner_id, c_dedupe, ext_uid in rows:
        if not ext_uid:
            continue
        # crm 的 dedupeKey 是 crm:sha1(...)，lead 的 dedupeKey 是 lead:sha256(...)
        # 两者算法不同，需按 externalUserId 匹配
        cur.execute(
            "SELECT id FROM leads WHERE external_user_id = ? LIMIT 1",
            (ext_uid,),
        )
        lead = cur.fetchone()
        if not lead:
            continue
        linked += 1
        if dry_run:
            continue
        # 回填：lead.customer_id = crm_customer.id（以及 lead 标记 converted）
        cur.execute(
            "UPDATE leads SET customer_id = ?, status = CASE WHEN status='pending' THEN 'converted' ELSE status END WHERE id = ?",
            (cid, lead[0]),
        )
    print(f"  crm_customers 回填: {linked} 个客户关联到 lead")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="SQLite 数据库路径")
    ap.add_argument("--dry-run", action="store_true", help="只统计不写入")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    cur = db.cursor()
    cur.execute("SELECT COUNT(*) FROM leads")
    before = cur.fetchone()[0]

    print(f"数据库: {args.db}")
    print(f"迁移前 leads: {before} 条")
    print("dry-run" if args.dry_run else "实际迁移")

    migrate_growth_leads(cur, db, args.dry_run)
    migrate_comment_leads(cur, args.dry_run)
    backfill_customer_lead(cur, args.dry_run)

    if not args.dry_run:
        db.commit()
    cur.execute("SELECT COUNT(*) FROM leads")
    after = cur.fetchone()[0]
    print(f"迁移后 leads: {after} 条（新增 {after - before} 条）")
    db.close()


if __name__ == "__main__":
    main()
