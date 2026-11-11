"""更新失败告警。

失败时写 `data/meta/alert.json`，成功时清除；API 与静态 payload 会把它带给前端，
页面顶部立即显示失败信息，不必等“数据落后 7 天”的兜底提示。
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from . import settings


def _path() -> Path:
    return settings.META / "alert.json"


def _friendly(message: str) -> str:
    text = str(message or "").strip()
    if not text:
        return "数据更新未完成，请稍后重试"
    if "Traceback (most recent call last)" in text:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith(("Traceback", "File \""))]
        if not lines:
            return "数据更新未完成，请稍后重试"
        text = lines[-1]
    if "No module named" in text:
        return "更新环境缺少依赖，请使用 breadthlab 环境执行"
    if "no permission" in text.lower():
        return "数据源权限不足，本次更新未完成"
    if "quality" in text.lower() or "gate" in text.lower():
        return "数据质量校验未通过，本次更新已中止"
    return text[:300]


def write(stage: str, message: str, log: str | None = None) -> dict:
    settings.META.mkdir(parents=True, exist_ok=True)
    payload = {
        "time": datetime.now().astimezone().isoformat(timespec="seconds"),
        "stage": stage,
        "message": _friendly(message),
        "log": log,
    }
    _path().write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def read() -> dict | None:
    p = _path()
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def clear() -> None:
    _path().unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="BreadthLab update alert")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--set", action="store_true")
    g.add_argument("--clear", action="store_true")
    g.add_argument("--show", action="store_true")
    ap.add_argument("--stage", default="update")
    ap.add_argument("--message", default="update failed")
    ap.add_argument("--log", default=None)
    args = ap.parse_args()

    if args.clear:
        clear()
        print("alert cleared")
    elif args.show:
        print(json.dumps(read(), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(write(args.stage, args.message, args.log), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
