/* 企画を1枚のPNGに書き出す（載せるのは タイトル・出演メンバー・形式・台本 だけ） */
(function () {
  "use strict";

  const FONT =
    '"Yu Gothic UI","Hiragino Sans","Hiragino Kaku Gothic ProN",Meiryo,"Segoe UI",system-ui,sans-serif';

  const W = 1080;
  const PAD = 64;
  const PAD_TOP = 56;
  const SCALE = 2;

  const TITLE_LH = 66;
  const PILL_H = 44;
  const PILL_PAD = 22;
  const PILL_GAP = 10;
  const ROW_GAP = 12;

  const THEME = {
    bg: "#ffffff",
    text: "#191d28",
    muted: "#79829a",
    line: "#e3e7ef",
    plainBorder: "#c9d0de",
    typeBg: "#f2f4f9",
    typeBorder: "#dde2ed",
    typeText: "#4a5163",
    // グループのタグは金色
    goldBorder: "#c9a227",
    goldText: "#8f7112",
    goldBg: "#faf3dd",
    // 全員のタグは黒
    allBorder: "#1b1f2a",
    allText: "#1b1f2a",
    allBg: "#f0f1f5",
  };

  const bold = (px) => `bold ${px}px ${FONT}`;
  const normal = (px) => `${px}px ${FONT}`;

  const TITLE_FONT = bold(46);
  const PILL_FONT = bold(26);
  const TYPE_FONT = bold(24);

  function memberColors() {
    const map = {};
    ((window.META && window.META.members) || []).forEach(
      (m) => (map[m.name] = m.color)
    );
    return map;
  }

  /** 白と混ぜて薄くする */
  function lighten(hex, t) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * t);
    return (
      "#" +
      [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function wrap(ctx, text, maxWidth) {
    const out = [];
    const src = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    for (const para of src.split("\n")) {
      if (para === "") {
        out.push("");
        continue;
      }
      let line = "";
      for (const ch of para) {
        const test = line + ch;
        if (line && ctx.measureText(test).width > maxWidth) {
          out.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      out.push(line);
    }
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 白地に、縁の色でメンバーを見分けるピル */
  function drawPill(ctx, x, y, pill) {
    roundRect(ctx, x + 1, y + 1, pill.w - 2, PILL_H - 2, (PILL_H - 2) / 2);
    ctx.fillStyle = pill.bg;
    ctx.fill();
    ctx.strokeStyle = pill.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = pill.font;
    ctx.fillStyle = pill.fg;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(pill.text, x + pill.w / 2, y + PILL_H / 2 + 1);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }

  /** タイトルの隣に並べるピルを組み立てる。個人企画は区分タグなしでメンバーだけ */
  function buildPills(plan, colors) {
    const pills = [];
    const groupTag = () => ({
      text: "グループ",
      font: PILL_FONT,
      bg: THEME.goldBg,
      border: THEME.goldBorder,
      fg: THEME.goldText,
    });

    if (plan.is_all_members) {
      pills.push(groupTag());
      pills.push({
        text: "全員",
        font: PILL_FONT,
        bg: THEME.allBg,
        border: THEME.allBorder,
        fg: THEME.allText,
      });
    } else {
      // グループ企画で一部メンバーのときは、先頭に金色の「グループ」タグを足す
      if (plan.category === "group") pills.push(groupTag());
      for (const name of plan.members || []) {
        const c = colors[name] || THEME.plainBorder;
        pills.push({
          text: name,
          font: PILL_FONT,
          bg: lighten(c, 0.88),
          border: c,
          fg: c,
        });
      }
    }

    pills.push({
      text: plan.video_type === "landscape" ? "横動画" : "ショート",
      font: TYPE_FONT,
      bg: THEME.typeBg,
      border: THEME.typeBorder,
      fg: THEME.typeText,
    });
    return pills;
  }

  function renderPlanPng(plan) {
    const inner = W - PAD * 2;
    const colors = memberColors();
    const m = document.createElement("canvas").getContext("2d");

    // ---- ピルの幅を測る ------------------------------------------------
    const pills = buildPills(plan, colors);
    for (const p of pills) {
      m.font = p.font;
      p.w = m.measureText(p.text).width + PILL_PAD * 2;
    }
    const pillsW =
      pills.reduce((s, p) => s + p.w, 0) + PILL_GAP * (pills.length - 1);

    // タイトルが1行で隣に収まるときだけ横並び。長いタイトルはメンバーを下の行へ
    const title = plan.title || "（無題）";
    const maxTitleW = inner - pillsW - 32;
    m.font = TITLE_FONT;
    const inline =
      maxTitleW > 0 && wrap(m, title, maxTitleW).length === 1;

    const titleLines = wrap(m, title, inline ? maxTitleW : inner);
    const titleH = titleLines.length * TITLE_LH;

    // 横並びに入らないときの行組み
    const rows = [[]];
    if (!inline) {
      let used = 0;
      for (const p of pills) {
        const r = rows.length - 1;
        const need = (rows[r].length ? PILL_GAP : 0) + p.w;
        if (rows[r].length && used + need > inner) {
          rows.push([p]);
          used = p.w;
        } else {
          rows[r].push(p);
          used += need;
        }
      }
    }
    const headH = inline
      ? Math.max(titleH, PILL_H)
      : titleH +
        18 +
        rows.length * PILL_H +
        (rows.length - 1) * ROW_GAP;

    // ---- 台本 -----------------------------------------------------------
    const script = (plan.script || "").trim();
    m.font = normal(26);
    const scriptLines = wrap(
      m,
      script || "（台本はまだ書かれていません）",
      inner
    );

    const RULE_GAP_TOP = 30;
    const RULE_GAP_BOTTOM = 28;
    const SECTION_H = 46;
    const SECTION_GAP = 12;
    const SCRIPT_LH = 46;

    const totalH =
      PAD_TOP +
      headH +
      RULE_GAP_TOP +
      1 +
      RULE_GAP_BOTTOM +
      SECTION_H +
      SECTION_GAP +
      scriptLines.length * SCRIPT_LH +
      PAD;

    // ---- 描画 -----------------------------------------------------------
    const cv = document.createElement("canvas");
    cv.width = W * SCALE;
    cv.height = Math.ceil(totalH) * SCALE;
    const ctx = cv.getContext("2d");
    ctx.scale(SCALE, SCALE);

    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, W, totalH);

    let y = PAD_TOP;

    // タイトル
    ctx.font = TITLE_FONT;
    ctx.fillStyle = THEME.text;
    titleLines.forEach((line, i) => {
      if (line) ctx.fillText(line, PAD, y + TITLE_LH * 0.72 + i * TITLE_LH);
    });

    // 出演メンバーと形式
    if (inline) {
      let x = W - PAD - pillsW;
      const py = y + (TITLE_LH - PILL_H) / 2;
      for (const p of pills) {
        drawPill(ctx, x, py, p);
        x += p.w + PILL_GAP;
      }
    } else {
      let ry = y + titleH + 18;
      for (const row of rows) {
        let rx = PAD;
        for (const p of row) {
          drawPill(ctx, rx, ry, p);
          rx += p.w + PILL_GAP;
        }
        ry += PILL_H + ROW_GAP;
      }
    }
    y += headH + RULE_GAP_TOP;

    // 区切り線
    ctx.strokeStyle = THEME.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y + 0.5);
    ctx.lineTo(W - PAD, y + 0.5);
    ctx.stroke();
    y += 1 + RULE_GAP_BOTTOM;

    // 「台本」の見出し
    const firstMember = (plan.members || []).map((n) => colors[n]).find(Boolean);
    ctx.fillStyle = firstMember || THEME.plainBorder;
    roundRect(ctx, PAD, y + 8, 5, 26, 2.5);
    ctx.fill();
    ctx.font = bold(24);
    ctx.fillStyle = THEME.muted;
    ctx.fillText("台本", PAD + 16, y + 30);
    y += SECTION_H + SECTION_GAP;

    // 台本本文
    ctx.font = normal(26);
    ctx.fillStyle = script ? THEME.text : THEME.muted;
    scriptLines.forEach((line, i) => {
      if (line) ctx.fillText(line, PAD, y + SCRIPT_LH * 0.72 + i * SCRIPT_LH);
    });

    return cv.toDataURL("image/png");
  }

  /** ファイル名に使えない文字を落とす */
  function safeName(s) {
    return String(s == null ? "" : s)
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** 「タイトル【出演メンバー】」形式のファイル名 */
  function fileName(plan) {
    const title = safeName(plan.title) || "企画";
    const members = plan.is_all_members
      ? "グループ"
      : safeName((plan.members || []).join("・")) || "未設定";
    return `${title.slice(0, 80)}【${members}】.png`;
  }

  window.renderPlanPng = renderPlanPng;

  window.downloadPlanPng = function (plan) {
    const url = renderPlanPng(plan);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(plan);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
})();
