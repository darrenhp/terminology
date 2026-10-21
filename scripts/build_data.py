# -*- coding: utf-8 -*-
"""汇总三个数据模块，生成 data/*.csv 与 data/domains.json。
用法: python3 scripts/build_data.py
"""
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data_collab import DOMAINS as D_COLLAB
from data_pm import DOMAINS as D_PM
from data_git import DOMAINS as D_GIT
from data_frontend import DOMAINS as D_FRONTEND
from data_backend import DOMAINS as D_BACKEND
from data_ai import DOMAINS as D_AI
from data_erp import DOMAINS as D_ERP
from data_wfm import DOMAINS as D_WFM
from data_charts import DOMAINS as D_CHARTS
from data_growth import DOMAINS as D_GROWTH
from data_finance import DOMAINS as D_FINANCE
from data_zhihu import DOMAINS as D_ZHIHU
from data_zhihu import MERGE_TERMS, DOMAIN_PATCH
from data_pitfall import PITFALLS, NEW_TERMS

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA_DIR = os.path.join(ROOT, "data")
HEADER = ["term", "en", "category", "definition", "scenario", "related", "pitfall"]
REQUIRED_COLS = 6  # pitfall 为可选列，允许为空

BASE_ORDER = D_COLLAB + D_PM + D_GIT + D_FRONTEND + D_BACKEND + D_AI + D_ERP + D_WFM + D_CHARTS + D_GROWTH + D_FINANCE


def _apply(domains):
    """套用改名 / 改组补丁，并追加从其他来源合并进来的术语。"""
    out = []
    for d in domains:
        d = dict(d)
        patch = DOMAIN_PATCH.get(d["id"])
        if patch:
            d.update(patch)
        extra = MERGE_TERMS.get(d["id"])
        if extra:
            d["terms"] = list(d["terms"]) + list(extra)
        out.append(d)
    return out


_order = _apply(BASE_ORDER)
# network 扩成「系统与网络基础」后改了分组，移到末尾与新建领域连续展示，避免分组被截断
_moved = [d for d in _order if d["id"] in DOMAIN_PATCH]
DOMAIN_ORDER = [d for d in _order if d["id"] not in DOMAIN_PATCH] + _moved + _apply(D_ZHIHU)


def build():
    os.makedirs(DATA_DIR, exist_ok=True)
    manifest = []
    seen_ids = set()
    seen_terms = {}
    hit_pitfalls = set()
    pit_count = 0
    problems = []

    for d in DOMAIN_ORDER:
        did = d["id"]
        if did in seen_ids:
            problems.append("重复领域 id: %s" % did)
        seen_ids.add(did)

        # 追加「避坑」补充条目，并把旧条目的 6 元组补齐到 7 列
        terms = []
        for t in list(d["terms"]) + list(NEW_TERMS.get(did, [])):
            t = list(t) + [""] * (len(HEADER) - len(t))
            if len(t) != len(HEADER):
                problems.append("%s: 字段数不为 %d: %r" % (did, len(HEADER), t))
                continue
            pitfall = PITFALLS.get((did, t[0]))
            if pitfall is not None:
                t[6] = pitfall
                hit_pitfalls.add((did, t[0]))
            for i, v in enumerate(t[:REQUIRED_COLS]):
                if v is None or str(v).strip() == "":
                    problems.append("%s: 空字段 [%s] 第%d列" % (did, t[0], i))
            key = (did, t[0])
            if key in seen_terms:
                problems.append("%s: 领域内重复术语 [%s]" % (did, t[0]))
            seen_terms[key] = True
            if str(t[6]).strip():
                pit_count += 1
            terms.append(t)

        path = os.path.join(DATA_DIR, did + ".csv")
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(HEADER)
            for t in terms:
                w.writerow(list(t))

        manifest.append({
            "id": did,
            "name": d["name"],
            "group": d["group"],
            "desc": d["desc"],
            "file": did + ".csv",
            "count": len(terms),
        })

    with open(os.path.join(DATA_DIR, "domains.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # 补坑条目若没匹配到术语（写错领域或改名），直接报错而不是静默丢弃
    for key in PITFALLS:
        if key not in hit_pitfalls:
            problems.append("补坑未命中术语: %s / %s" % (key[0], key[1]))

    total = sum(m["count"] for m in manifest)
    print("生成 %d 个领域 CSV, 共 %d 条术语 -> %s" % (len(manifest), total, DATA_DIR))
    for m in manifest:
        print("  %-18s %-12s %3d 条  (%s)" % (m["id"], m["group"], m["count"], m["file"]))
    print("  其中带「坑」的术语 %d 条" % pit_count)
    if problems:
        print("\n发现问题 %d 处:" % len(problems))
        for p in problems:
            print("  ! " + p)
        sys.exit(1)
    print("校验通过: 无空字段、无重复术语")


if __name__ == "__main__":
    build()
