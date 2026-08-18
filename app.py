# -*- coding: utf-8 -*-
"""企画管理ツール — 企画の共有 / 台本の編集・追加 / 承認。"""

import os
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

import storage
from line_notify import notify

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
JST = timezone(timedelta(hours=9))

# ---------------------------------------------------------------- 設定

# ログインできる人。can_approve が True の人だけ「承認」ボタンを押せる。
USERS = {
    "rento": {"name": "れんと", "can_approve": False},
    "hinagi": {"name": "ひなぎ", "can_approve": True},
}

# メンバーと表示色。ここを直すと画面・PNGの色がまとめて変わる
MEMBERS = [
    {"name": "ひなぎ", "color": "#3fc6ea"},  # 水色
    {"name": "れんと", "color": "#e5493e"},  # 赤
    {"name": "つばき", "color": "#a865e8"},  # 紫
    {"name": "ゆめち", "color": "#ff5fa2"},  # ピンク
    {"name": "ぎる", "color": "#3a6fe0"},    # 青
    {"name": "くろば", "color": "#25b566"},  # 緑
]
MEMBER_NAMES = [m["name"] for m in MEMBERS]

CATEGORIES = {"group": "グループ", "personal": "個人"}
VIDEO_TYPES = {"short": "ショート", "landscape": "横動画"}
STATUSES = {"pending": "未承認", "approved": "承認済み"}

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or "dev-secret-please-change"
app.permanent_session_lifetime = timedelta(days=90)


# ---------------------------------------------------------------- 補助

def now_jst() -> str:
    """画面表示用（分まで）。"""
    return datetime.now(JST).strftime("%Y-%m-%d %H:%M")


def now_jst_sec() -> str:
    """並び替え用（秒まで）。"""
    return datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")


def current_user() -> dict | None:
    key = session.get("user")
    if key in USERS:
        return {"key": key, **USERS[key]}
    return None


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            if request.path.startswith("/api/"):
                return jsonify({"error": "ログインが必要です"}), 401
            return redirect(url_for("login"))
        return fn(*args, **kwargs)

    return wrapper


def normalize_members(plan: dict) -> list[str]:
    """members を正規の並び順に整える。旧形式(category/member)のデータも拾う。"""
    raw = plan.get("members")
    if raw is None:
        # 旧データ: 個人=member1人 / グループ=全員 とみなす
        raw = (
            [plan["member"]]
            if plan.get("category") == "personal" and plan.get("member")
            else list(MEMBER_NAMES)
        )
    return [name for name in MEMBER_NAMES if name in raw]


def enrich(plan: dict) -> dict:
    """表示用のラベルを足して返す。"""
    p = dict(plan)
    members = normalize_members(p)
    p["members"] = members

    category = p.get("category")
    if category not in CATEGORIES:
        # 旧データからの推測：全員そろっていればグループ、それ以外は個人
        category = "group" if len(members) == len(MEMBER_NAMES) else "personal"
    p["category"] = category
    p["is_all_members"] = category == "group" and len(members) == len(MEMBER_NAMES)
    p["kind_label"] = CATEGORIES[category]

    joined = "・".join(members)
    p["owner_label"] = (
        "グループ（全員）"
        if p["is_all_members"]
        else (f"グループ：{joined}" if category == "group" else joined)
    )
    p["video_type_label"] = VIDEO_TYPES.get(p.get("video_type"), "ショート")
    p["status_label"] = STATUSES.get(p.get("status"), "未承認")
    for field in ("created_by", "updated_by", "approved_by"):
        key = p.get(field)
        p[field + "_name"] = USERS.get(key, {}).get("name", "") if key else ""
    return p


def touch(plan: dict, user: dict) -> None:
    """更新者と更新日時を打ち直す。updated_ts は一覧の並び替え用。"""
    plan["updated_by"] = user["key"]
    plan["updated_at"] = now_jst()
    plan["updated_ts"] = now_jst_sec()


def log_activity(action: str, plan: dict, user: dict) -> None:
    storage.add_activity(
        {
            "id": str(uuid.uuid4()),
            "created_at": now_jst_sec(),
            "action": action,
            "plan_id": plan["id"],
            "title": plan["title"],
            "user": user["name"],
        }
    )


def clean_payload(data: dict, base: dict | None = None) -> tuple[dict, str | None]:
    """フォーム入力を検証して企画データの形に整える。"""
    base = base or {}

    title = (data.get("title") or "").strip()
    if not title:
        return {}, "タイトルを入力してください。"
    if len(title) > 120:
        return {}, "タイトルは120文字以内で入力してください。"

    category = data.get("category")
    if category not in CATEGORIES:
        category = "group"

    raw_members = data.get("members") or []
    members = [name for name in MEMBER_NAMES if name in raw_members]
    if not members:
        return {}, "出演メンバーを1人以上選んでください。"

    video_type = data.get("video_type")
    if video_type not in VIDEO_TYPES:
        video_type = "short"

    has_reference = bool(data.get("has_reference"))
    reference_url = (data.get("reference_url") or "").strip()
    if has_reference:
        if not reference_url:
            return {}, "参考動画のURLを入力するか、「参考動画なし」にチェックしてください。"
        if not reference_url.startswith(("http://", "https://")):
            return {}, "参考動画のURLは http:// または https:// で始めてください。"
    else:
        reference_url = ""

    plan = {
        **base,
        "title": title,
        "category": category,
        "members": members,
        "video_type": video_type,
        "has_reference": has_reference,
        "reference_url": reference_url,
        "script": (data.get("script") or "").rstrip(),
    }
    # 旧形式のキーが残っていたら捨てる
    for legacy in ("member", "outline", "personal_type"):
        plan.pop(legacy, None)

    return plan, None


# ---------------------------------------------------------------- 画面

@app.get("/login")
def login():
    if current_user():
        return redirect(url_for("index"))
    return render_template(
        "login.html",
        users=[{"key": k, **v} for k, v in USERS.items()],
        error=request.args.get("error", ""),
    )


@app.post("/login")
def do_login():
    user = request.form.get("user", "")
    if user not in USERS:
        return redirect(url_for("login", error="ユーザーを選んでください。"))
    session.permanent = True
    session["user"] = user
    return redirect(url_for("index"))


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/")
@login_required
def index():
    return render_template(
        "index.html",
        me=current_user(),
        meta={
            "members": MEMBERS,
            "categories": CATEGORIES,
            "video_types": VIDEO_TYPES,
            "statuses": STATUSES,
        },
    )


# ---------------------------------------------------------------- API

@app.get("/api/plans")
@login_required
def api_list_plans():
    return jsonify({"plans": [enrich(p) for p in storage.list_plans()]})


@app.post("/api/plans")
@login_required
def api_create_plan():
    me = current_user()
    data = request.get_json(silent=True) or {}
    now = now_jst()
    plan, error = clean_payload(
        data,
        {
            "id": str(uuid.uuid4()),
            "status": "pending",
            "created_by": me["key"],
            "created_at": now,
            "approved_by": None,
            "approved_at": None,
        },
    )
    if error:
        return jsonify({"error": error}), 400

    touch(plan, me)
    storage.save_plan(plan)
    log_activity("created", plan, me)
    notify(f"【企画を追加】{plan['title']}\n{me['name']} さんが新しい企画を追加しました。")
    return jsonify({"plan": enrich(plan)}), 201


@app.put("/api/plans/<plan_id>")
@login_required
def api_update_plan(plan_id):
    me = current_user()
    existing = storage.get_plan(plan_id)
    if not existing:
        return jsonify({"error": "企画が見つかりません。"}), 404

    data = request.get_json(silent=True) or {}
    plan, error = clean_payload(data, existing)
    if error:
        return jsonify({"error": error}), 400

    touch(plan, me)

    reverted = False
    if existing.get("status") == "approved":
        # 承認後に台本が変わったら、承認を取り消して確認し直してもらう
        plan["status"] = "pending"
        plan["approved_by"] = None
        plan["approved_at"] = None
        reverted = True

    storage.save_plan(plan)
    log_activity("updated", plan, me)
    msg = f"【企画を編集】{plan['title']}\n{me['name']} さんが編集しました。"
    if reverted:
        msg += "\n※承認済みだったため未承認に戻りました。"
    notify(msg)
    return jsonify({"plan": enrich(plan), "reverted": reverted})


@app.post("/api/plans/<plan_id>/approve")
@login_required
def api_approve_plan(plan_id):
    me = current_user()
    if not me["can_approve"]:
        return jsonify({"error": f"承認できるのは {USERS['hinagi']['name']} さんだけです。"}), 403

    plan = storage.get_plan(plan_id)
    if not plan:
        return jsonify({"error": "企画が見つかりません。"}), 404

    approve = bool((request.get_json(silent=True) or {}).get("approve", True))
    now = now_jst()
    plan["status"] = "approved" if approve else "pending"
    plan["approved_by"] = me["key"] if approve else None
    plan["approved_at"] = now if approve else None
    touch(plan, me)

    storage.save_plan(plan)
    log_activity("approved" if approve else "unapproved", plan, me)
    if approve:
        notify(f"【台本を承認】{plan['title']}\n{me['name']} さんが承認しました。")
    else:
        notify(f"【承認を取り消し】{plan['title']}\n{me['name']} さんが承認を取り消しました。")
    return jsonify({"plan": enrich(plan)})


@app.delete("/api/plans/<plan_id>")
@login_required
def api_delete_plan(plan_id):
    me = current_user()
    plan = storage.get_plan(plan_id)
    if not plan:
        return jsonify({"error": "企画が見つかりません。"}), 404
    storage.delete_plan(plan_id)
    log_activity("deleted", plan, me)
    return jsonify({"ok": True})


@app.get("/api/activities")
@login_required
def api_activities():
    return jsonify({"activities": storage.list_activities(30)})


@app.delete("/api/activities")
@login_required
def api_clear_activities():
    """更新履歴を全部消す（見やすくするための手動リセット）。企画そのものは消えない。"""
    storage.clear_activities()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- 起動

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5057))
    print("=" * 52)
    print("  企画管理ツール")
    print(f"  ブラウザで  http://127.0.0.1:{port}  を開いてください")
    print(f"  保存先: {storage.backend_name()}")
    print("  終了するには Ctrl+C")
    print("=" * 52)
    app.run(host="0.0.0.0", port=port, debug=False)
