# -*- coding: utf-8 -*-
"""データ保存層。

ローカル実行時は SQLite（data/plans.db）、
クラウド（Render 等）では環境変数 DATABASE_URL の Postgres を使う。
企画データは JSON 文字列として 1 カラムに入れているので、
項目を増やしてもマイグレーション不要。
"""

import json
import os

from sqlalchemy import (
    Column,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    delete,
    insert,
    select,
    update,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _database_url() -> str:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if url:
        # Render / Heroku 形式の postgres:// を SQLAlchemy 用に変換
        if url.startswith("postgres://"):
            url = "postgresql+psycopg2://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg2://" + url[len("postgresql://"):]
        return url

    data_dir = os.environ.get("DATA_DIR") or os.path.join(BASE_DIR, "data")
    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, "plans.db").replace("\\", "/")
    return "sqlite:///" + db_path


_engine = create_engine(_database_url(), future=True, pool_pre_ping=True)
_metadata = MetaData()

_plans = Table(
    "plans",
    _metadata,
    Column("id", String(36), primary_key=True),
    Column("body", Text, nullable=False),
    Column("updated_at", String(32), nullable=False, index=True),
)

_activities = Table(
    "activities",
    _metadata,
    Column("id", String(36), primary_key=True),
    Column("body", Text, nullable=False),
    Column("created_at", String(32), nullable=False, index=True),
)

_metadata.create_all(_engine)


def backend_name() -> str:
    return _engine.dialect.name


# ---------------------------------------------------------------- 企画

def list_plans() -> list[dict]:
    with _engine.connect() as conn:
        rows = conn.execute(
            select(_plans.c.body).order_by(_plans.c.updated_at.desc())
        ).fetchall()
    return [json.loads(r[0]) for r in rows]


def get_plan(plan_id: str) -> dict | None:
    with _engine.connect() as conn:
        row = conn.execute(
            select(_plans.c.body).where(_plans.c.id == plan_id)
        ).fetchone()
    return json.loads(row[0]) if row else None


def save_plan(plan: dict) -> dict:
    body = json.dumps(plan, ensure_ascii=False)
    sort_key = plan.get("updated_ts") or plan["updated_at"]
    with _engine.begin() as conn:
        exists = conn.execute(
            select(_plans.c.id).where(_plans.c.id == plan["id"])
        ).fetchone()
        if exists:
            conn.execute(
                update(_plans)
                .where(_plans.c.id == plan["id"])
                .values(body=body, updated_at=sort_key)
            )
        else:
            conn.execute(
                insert(_plans).values(id=plan["id"], body=body, updated_at=sort_key)
            )
    return plan


def delete_plan(plan_id: str) -> None:
    with _engine.begin() as conn:
        conn.execute(delete(_plans).where(_plans.c.id == plan_id))


# ---------------------------------------------------------------- 履歴

def add_activity(activity: dict) -> dict:
    with _engine.begin() as conn:
        conn.execute(
            insert(_activities).values(
                id=activity["id"],
                body=json.dumps(activity, ensure_ascii=False),
                created_at=activity["created_at"],
            )
        )
    return activity


def clear_activities() -> None:
    with _engine.begin() as conn:
        conn.execute(delete(_activities))


def list_activities(limit: int = 30) -> list[dict]:
    with _engine.connect() as conn:
        rows = conn.execute(
            select(_activities.c.body)
            .order_by(_activities.c.created_at.desc())
            .limit(limit)
        ).fetchall()
    return [json.loads(r[0]) for r in rows]
