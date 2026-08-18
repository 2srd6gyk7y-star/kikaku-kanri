# -*- coding: utf-8 -*-
"""LINE 公式アカウント（Messaging API）への通知。

環境変数が未設定のうちは何もしない（＝現状は無効）。
あとで以下を設定するだけで通知が飛ぶようになる:

  LINE_CHANNEL_ACCESS_TOKEN  … LINE Developers のチャネルアクセストークン（長期）
  LINE_TO                    … 送信先の userId / groupId。
                               未指定ならブロードキャスト（友だち全員）に送る。
  APP_BASE_URL               … 通知文に載せるツールのURL（任意）
"""

import json
import os
import urllib.error
import urllib.request

_API_PUSH = "https://api.line.me/v2/bot/message/push"
_API_BROADCAST = "https://api.line.me/v2/bot/message/broadcast"


def is_enabled() -> bool:
    return bool((os.environ.get("LINE_CHANNEL_ACCESS_TOKEN") or "").strip())


def notify(text: str) -> bool:
    """LINE にテキストを送る。未設定・失敗時は False を返すだけで例外は投げない。"""
    token = (os.environ.get("LINE_CHANNEL_ACCESS_TOKEN") or "").strip()
    if not token:
        return False

    base_url = (os.environ.get("APP_BASE_URL") or "").strip()
    if base_url:
        text = f"{text}\n{base_url}"

    to = (os.environ.get("LINE_TO") or "").strip()
    url = _API_PUSH if to else _API_BROADCAST
    payload: dict = {"messages": [{"type": "text", "text": text[:4900]}]}
    if to:
        payload["to"] = to

    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as res:
            return 200 <= res.status < 300
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"[LINE] 通知に失敗しました: {e}")
        return False
