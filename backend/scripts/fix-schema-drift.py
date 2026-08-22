#!/usr/bin/env python3
"""对比 prisma schema 与生产 PostgreSQL，生成缺失列的 ALTER DDL 并执行。
用法: python3 fix-schema-drift.py <schema路径> <ssh-host> <db-container> <db-user> <db-name>
"""
import re, subprocess, sys, json

SCHEMA = sys.argv[1]
SSH = sys.argv[2]
CONTAINER = sys.argv[3]
DBUSER = sys.argv[4]
DBNAME = sys.argv[5]

TYPE_MAP = {
    'String': 'TEXT',
    'Int': 'INTEGER',
    'Boolean': 'BOOLEAN',
    'DateTime': 'TIMESTAMP(3)',
    'Json': 'JSONB',
    'Float': 'DOUBLE PRECISION',
    'Decimal': 'DECIMAL(65,30)',
    'BigInt': 'BIGINT',
}

def ssh(cmd):
    r = subprocess.run(['ssh', '-o', 'ConnectTimeout=30', '-o', 'BatchMode=yes', SSH, cmd],
                       capture_output=True, text=True, env={k: v for k, v in __import__('os').environ.items() if k not in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy')})
    return r.stdout

def snake(name):
    return re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()

SCALARS = {'String','Int','Boolean','DateTime','Json','Float','Decimal','BigInt'}

# 1. 解析 schema
src = open(SCHEMA).read()
models = {}
model_names = set(re.findall(r'^model\s+(\w+)\s*\{', src, re.M))
enum_names = set(re.findall(r'^enum\s+(\w+)\s*\{', src, re.M))
for m in re.finditer(r'^model\s+(\w+)\s*\{([^}]*)\}', src, re.M):
    name, body = m.group(1), m.group(2)
    mapm = re.search(r'@@map\("([^"]+)"\)', body)
    table = mapm.group(1) if mapm else snake(name)
    fields = []
    for f in re.finditer(r'^\s+(\w+)\s+([\w\[\]?]+)\s*(.*?)$', body, re.M):
        fname, ftype, rest = f.group(1), f.group(2), f.group(3)
        if fname in ('id',) or fname.startswith('@@') or fname in ('createdAt','updatedAt'):
            continue
        is_optional = ftype.endswith('?') or '?' in ftype
        bare = ftype.rstrip('?[]')
        if bare in model_names:
            continue  # 关系字段不是列
        mapcol = re.search(r'@map\("([^"]+)"\)', rest)
        col = mapcol.group(1) if mapcol else snake(fname)
        fields.append((fname, bare, is_optional, col, rest))
    models[table] = fields

print(f"解析到 {len(models)} 个模型")

# 2. 拉生产库所有表列
out = ssh(f"docker exec {CONTAINER} psql -U {DBUSER} -d {DBNAME} -t -A -c \"SELECT table_name || '|' || column_name FROM information_schema.columns WHERE table_schema='public';\" 2>/dev/null")
cols = {}
for line in out.splitlines():
    line = line.strip()
    if '|' in line:
        t, c = line.split('|', 1)
        cols.setdefault(t, set()).add(c)
print(f"生产库 {len(cols)} 张表")

# 3. 生成缺失列 DDL
ddl = []
skipped = []
for table, fields in models.items():
    if table not in cols:
        skipped.append(f"{table}（表不存在，跳过）")
        continue
    for fname, ftype, is_optional, col, rest in fields:
        if col in cols[table]:
            continue
        pgtype = TYPE_MAP.get(bare)
        if not pgtype:
            # 枚举或自定义类型 → 保守用 TEXT
            if re.fullmatch(r'[A-Z]\w*', bare) and bare not in TYPE_MAP:
                pgtype = 'TEXT'
            else:
                skipped.append(f"{table}.{col}（未知类型 {bare}）")
                continue
        defm = re.search(r'@default\((.*?)\)', rest)
        parts = [f'ADD COLUMN IF NOT EXISTS "{col}" {pgtype}']
        if defm and not is_optional:
            dv = defm.group(1)
            if dv.startswith('now()'): continue  # createdAt 已跳过
            if dv in ('true','false'): parts.append(f"DEFAULT {dv}")
            elif dv.startswith('"') and dv.endswith('"'): parts.append(f"DEFAULT '{dv[1:-1]}'")
            elif dv.startswith("'") and dv.endswith("'"): parts.append(f"DEFAULT {dv}")
            elif dv in ('now()','CURRENT_TIMESTAMP'): pass
            else: parts.append(f"DEFAULT '{dv}'")
        elif not is_optional and not defm:
            parts.append('DEFAULT NULL')  # 保守：避免 NOT NULL 阻塞
        ddl.append(f'ALTER TABLE "{table}" ' + ' '.join(parts) + ';')
        cols[table].add(col)

print(f"\n生成 {len(ddl)} 条补列 DDL")
for d in ddl:
    print("  " + d)
if skipped:
    print("\n跳过:")
    for s in skipped:
        print("  - " + s)

if not ddl:
    print("\n✅ 无缺失列")
    sys.exit(0)

# 4. 执行（保守：先打印，--apply 才执行）
if '--apply' in sys.argv:
    sql = "\n".join(ddl)
    r = ssh(f"docker exec -i {CONTAINER} psql -U {DBUSER} -d {DBNAME}") 
    # 通过 stdin 执行
    p = subprocess.run(['ssh', '-o', 'ConnectTimeout=30', '-o', 'BatchMode=yes', SSH,
                        f"docker exec -i {CONTAINER} psql -U {DBUSER} -d {DBNAME}"],
                       input=sql, capture_output=True, text=True,
                       env={k: v for k, v in __import__('os').environ.items() if k not in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy')})
    print("\n执行结果:")
    print(p.stdout[-2000:])
    if p.stderr.strip():
        print("STDERR:", p.stderr[-1000:])
