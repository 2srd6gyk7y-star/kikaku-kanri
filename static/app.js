/* 企画管理ツール — 画面まわり */
(function () {
  "use strict";

  const ME = window.ME;
  const META = window.META;

  const $ = (id) => document.getElementById(id);

  const MEMBER_NAMES = META.members.map((m) => m.name);
  const MEMBER_COLOR = {};
  META.members.forEach((m) => (MEMBER_COLOR[m.name] = m.color));

  /** #rrggbb → rgba(...) */
  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  const state = {
    plans: [],
    filters: { kind: "all", type: "all", status: "all", q: "" },
    editingId: null,
    detailId: null,
  };

  // ------------------------------------------------------------ 通信

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (res.status === 401) {
      location.href = "/login";
      throw new Error("unauthorized");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "通信に失敗しました。");
    return data;
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 2600);
  }

  // ------------------------------------------------------------ フィルタ

  const FILTER_DEFS = {
    kind: () => [
      { value: "all", label: "すべて" },
      { value: "group", label: "グループ" },
      { value: "personal", label: "個人" },
    ],
    type: () => [
      { value: "all", label: "すべて" },
      { value: "short", label: "ショート", accent: "short" },
      { value: "landscape", label: "横動画", accent: "landscape" },
    ],
    status: () => [
      { value: "all", label: "すべて" },
      { value: "pending", label: "未承認", accent: "pending" },
      { value: "approved", label: "承認済み", accent: "approved" },
    ],
  };

  function buildFilters() {
    for (const key of Object.keys(FILTER_DEFS)) {
      const box = $("filter-" + key);
      box.innerHTML = "";
      for (const opt of FILTER_DEFS[key]()) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = opt.label;
        b.dataset.value = opt.value;
        if (opt.accent) b.dataset.accent = opt.accent;
        b.addEventListener("click", () => {
          state.filters[key] = opt.value;
          saveFilters();
          syncChips();
          renderList();
        });
        box.appendChild(b);
      }
    }
    syncChips();
  }

  function syncChips() {
    for (const key of Object.keys(FILTER_DEFS)) {
      for (const chip of $("filter-" + key).children) {
        chip.classList.toggle(
          "is-active",
          chip.dataset.value === state.filters[key]
        );
      }
    }
  }

  function saveFilters() {
    try {
      localStorage.setItem("kikaku.filters", JSON.stringify(state.filters));
    } catch (e) {
      /* 保存できなくても動作に影響なし */
    }
  }

  function loadFilters() {
    try {
      const saved = JSON.parse(localStorage.getItem("kikaku.filters") || "{}");
      // 知っているキーだけ拾う（昔の形式が残っていても無視される）
      for (const key of Object.keys(FILTER_DEFS)) {
        const values = FILTER_DEFS[key]().map((o) => o.value);
        if (values.includes(saved[key])) state.filters[key] = saved[key];
      }
    } catch (e) {
      /* 壊れていたら初期値のまま */
    }
  }

  function matches(plan) {
    const f = state.filters;

    if (f.kind !== "all" && plan.category !== f.kind) return false;
    if (f.type !== "all" && plan.video_type !== f.type) return false;
    if (f.status !== "all" && plan.status !== f.status) return false;

    if (f.q) {
      const hay = [plan.title, plan.script, (plan.members || []).join(" ")]
        .join("\n")
        .toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ 一覧描画

  function badge(text, cls) {
    return `<span class="badge ${cls || ""}">${esc(text)}</span>`;
  }

  function memberBadge(name) {
    const c = MEMBER_COLOR[name] || "#8a93a8";
    return (
      `<span class="badge" style="background:${alpha(c, 0.18)};` +
      `color:${c};border-color:${alpha(c, 0.55)}">${esc(name)}</span>`
    );
  }

  /**
   * グループ企画だけ金色の「グループ」タグを付ける（個人はタグなし）。
   * 全員のときはメンバー名を並べずタグ1枚にまとめる。PNGと同じルール。
   */
  function ownerBadges(plan) {
    const group = plan.category === "group";
    const tag = group ? '<span class="badge group-tag">グループ</span>' : "";
    if (plan.is_all_members) {
      return tag + '<span class="badge all-tag">全員</span>';
    }
    return tag + (plan.members || []).map(memberBadge).join("");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function renderList() {
    const list = $("list");
    const shown = state.plans.filter(matches);

    $("count").textContent = `${shown.length} / ${state.plans.length} 件`;
    $("empty").hidden = shown.length > 0;
    list.innerHTML = "";

    for (const p of shown) {
      const el = document.createElement("article");
      el.className = "card";
      el.dataset.type = p.video_type;
      el.innerHTML = `
        <div class="badges">
          ${ownerBadges(p)}
          ${badge(p.video_type_label, p.video_type)}
          ${badge(p.status_label, p.status)}
        </div>
        <h3 class="card-title">${esc(p.title)}</h3>
        <p class="card-excerpt">${esc((p.script || "").trim() || "（台本未記入）")}</p>
        ${
          p.has_reference && p.reference_url
            ? `<p class="card-ref">🔗 <a href="${esc(p.reference_url)}" target="_blank" rel="noopener">参考動画を見る</a></p>`
            : `<p class="card-ref" style="color:var(--muted)">参考動画なし</p>`
        }
        <div class="card-foot">
          <span>更新 ${esc(p.updated_by_name)}</span>
          <span>${esc(p.updated_at)}</span>
        </div>`;
      el.addEventListener("click", (ev) => {
        if (ev.target.closest("a")) return;
        openDetail(p.id);
      });
      list.appendChild(el);
    }
  }

  const ACTION_LABEL = {
    created: "追加",
    updated: "編集",
    approved: "承認",
    unapproved: "承認取消",
    deleted: "削除",
  };

  async function renderActivities() {
    const { activities } = await api("/api/activities");
    const ul = $("activity-list");
    ul.innerHTML = "";
    if (!activities.length) {
      ul.innerHTML = `<li><span class="who">まだ履歴はありません。</span></li>`;
      return;
    }
    for (const a of activities) {
      const li = document.createElement("li");
      li.innerHTML =
        `<time>${esc(a.created_at)}</time>` +
        `<span class="act ${a.action}">${esc(ACTION_LABEL[a.action] || a.action)}</span>` +
        `<span>${esc(a.title)}</span>` +
        `<span class="who">/ ${esc(a.user)}</span>`;
      ul.appendChild(li);
    }
  }

  // ------------------------------------------------------------ 詳細

  function findPlan(id) {
    return state.plans.find((p) => p.id === id);
  }

  function openDetail(id) {
    const p = findPlan(id);
    if (!p) return;
    state.detailId = id;

    $("detail-badges").innerHTML =
      ownerBadges(p) +
      badge(p.video_type_label, p.video_type) +
      badge(p.status_label, p.status);
    $("detail-title").textContent = p.title;

    const meta = [`作成 ${p.created_by_name}（${p.created_at}）`,
                  `更新 ${p.updated_by_name}（${p.updated_at}）`];
    if (p.status === "approved" && p.approved_by_name) {
      meta.push(`承認 ${p.approved_by_name}（${p.approved_at}）`);
    }
    $("detail-meta").textContent = meta.join("　/　");

    $("detail-ref-wrap").hidden = false;
    $("detail-ref").innerHTML =
      p.has_reference && p.reference_url
        ? `<a href="${esc(p.reference_url)}" target="_blank" rel="noopener">${esc(p.reference_url)}</a>`
        : `<span style="color:var(--muted)">参考動画なし</span>`;

    $("detail-script").textContent = (p.script || "").trim() || "（台本未記入）";

    const approveBtn = $("btn-approve");
    if (!ME.can_approve) {
      approveBtn.hidden = true;
    } else {
      approveBtn.hidden = false;
      const approved = p.status === "approved";
      approveBtn.textContent = approved ? "承認を取り消す" : "✓ 承認する";
      approveBtn.className = approved ? "btn btn-ghost" : "btn btn-approve";
    }

    show("modal-detail");
  }

  // ------------------------------------------------------------ 編集

  function buildRadios(boxId, name, options) {
    const box = $(boxId);
    box.innerHTML = "";
    for (const o of options) {
      const label = document.createElement("label");
      label.innerHTML =
        `<input type="radio" name="${name}" value="${esc(o.value)}">` +
        `<span>${esc(o.label)}</span>`;
      box.appendChild(label);
    }
  }

  function radioValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  }

  function setRadio(name, value) {
    const el = document.querySelector(
      `input[name="${name}"][value="${value}"]`
    );
    if (el) el.checked = true;
  }

  function buildMemberChecks() {
    const box = $("f-members");
    box.innerHTML = "";
    for (const m of META.members) {
      const label = document.createElement("label");
      label.className = "member-check";
      label.style.setProperty("--mc", m.color);
      label.style.setProperty("--mc-soft", alpha(m.color, 0.2));
      label.innerHTML =
        `<input type="checkbox" name="members" value="${esc(m.name)}">` +
        `<span>${esc(m.name)}</span>`;
      box.appendChild(label);
    }
  }

  function checkedMembers() {
    return [...document.querySelectorAll('input[name="members"]:checked')].map(
      (el) => el.value
    );
  }

  function setMembers(names) {
    const set = new Set(names && names.length ? names : MEMBER_NAMES);
    document
      .querySelectorAll('input[name="members"]')
      .forEach((el) => (el.checked = set.has(el.value)));
    syncAllMembersBox();
  }

  /** 「全員」チェックの見た目を実際の選択に合わせる */
  function syncAllMembersBox() {
    const n = checkedMembers().length;
    const all = $("f-all-members");
    all.checked = n === MEMBER_NAMES.length;
    all.indeterminate = n > 0 && n < MEMBER_NAMES.length;
  }

  const isGroup = () => radioValue("category") === "group";

  /** 区分にあわせて出演メンバー欄の表示を切り替える（「全員」はグループのみ） */
  function syncCategoryUI() {
    const group = isGroup();
    $("f-all-wrap").hidden = !group;
    $("f-members-hint").textContent = group
      ? "この企画に出るメンバーを選びます。全員なら「全員」にチェック。"
      : "出演するメンバーを選びます（1人でも複数人でもOK）。";
    syncAllMembersBox();
  }

  function syncRefVisibility() {
    const off = $("f-no-ref").checked;
    $("f-ref-url").disabled = off;
    $("f-ref-url").style.opacity = off ? ".4" : "1";
    if (off) $("f-ref-url").value = "";
  }

  function openEditor(id) {
    state.editingId = id || null;
    const p = id ? findPlan(id) : null;

    $("edit-heading").textContent = p ? "企画を編集" : "新規企画";
    $("edit-error").hidden = true;
    $("edit-notice").hidden = !(p && p.status === "approved");

    $("f-title").value = p ? p.title : "";
    setRadio("category", p ? p.category : "group");
    setMembers(p ? p.members : []);
    syncCategoryUI();
    setRadio("video_type", p ? p.video_type : "short");
    $("f-no-ref").checked = p ? !p.has_reference : false;
    $("f-ref-url").value = p ? p.reference_url || "" : "";
    $("f-script").value = p ? p.script || "" : "";

    syncRefVisibility();
    show("modal-edit");
    setTimeout(() => $("f-title").focus(), 60);
  }

  async function savePlan() {
    const payload = {
      title: $("f-title").value,
      category: radioValue("category"),
      members: checkedMembers(),
      video_type: radioValue("video_type"),
      has_reference: !$("f-no-ref").checked,
      reference_url: $("f-ref-url").value,
      script: $("f-script").value,
    };

    const btn = $("btn-save");
    btn.disabled = true;
    try {
      const isNew = !state.editingId;
      const res = await api(
        isNew ? "/api/plans" : "/api/plans/" + state.editingId,
        { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) }
      );
      hide("modal-edit");
      await reload();
      toast(
        res.reverted
          ? "保存しました（未承認に戻りました）"
          : isNew
          ? "企画を追加しました"
          : "保存しました"
      );
      if (state.detailId && findPlan(res.plan.id)) openDetail(res.plan.id);
    } catch (e) {
      const err = $("edit-error");
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------ モーダル制御

  function show(id) {
    $(id).hidden = false;
    document.body.style.overflow = "hidden";
  }

  function hide(id) {
    $(id).hidden = true;
    if ($("modal-detail").hidden && $("modal-edit").hidden) {
      document.body.style.overflow = "";
    }
  }

  // ------------------------------------------------------------ 初期化

  async function reload() {
    const { plans } = await api("/api/plans");
    state.plans = plans;
    renderList();
    renderActivities();
  }

  function bind() {
    $("btn-new").addEventListener("click", () => openEditor(null));

    $("q").addEventListener("input", (e) => {
      state.filters.q = e.target.value.trim();
      renderList();
    });

    $("btn-save").addEventListener("click", savePlan);

    $("btn-edit").addEventListener("click", () => openEditor(state.detailId));

    $("btn-png").addEventListener("click", () => {
      const p = findPlan(state.detailId);
      if (p) {
        window.downloadPlanPng(p);
        toast("PNGをダウンロードしました");
      }
    });

    $("btn-approve").addEventListener("click", async () => {
      const p = findPlan(state.detailId);
      if (!p) return;
      const approve = p.status !== "approved";
      if (!approve && !confirm("承認を取り消しますか？")) return;
      try {
        const res = await api(`/api/plans/${p.id}/approve`, {
          method: "POST",
          body: JSON.stringify({ approve }),
        });
        await reload();
        openDetail(res.plan.id);
        toast(approve ? "承認しました" : "承認を取り消しました");
      } catch (e) {
        toast(e.message);
      }
    });

    $("btn-delete").addEventListener("click", async () => {
      const p = findPlan(state.detailId);
      if (!p) return;
      if (!confirm(`「${p.title}」を削除します。よろしいですか？`)) return;
      try {
        await api("/api/plans/" + p.id, { method: "DELETE" });
        hide("modal-detail");
        state.detailId = null;
        await reload();
        toast("削除しました");
      } catch (e) {
        toast(e.message);
      }
    });

    document.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => {
        const modal = el.closest(".modal");
        if (modal) hide(modal.id);
        if (modal && modal.id === "modal-detail") state.detailId = null;
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("modal-edit").hidden) hide("modal-edit");
      else if (!$("modal-detail").hidden) {
        hide("modal-detail");
        state.detailId = null;
      }
    });

    $("f-no-ref").addEventListener("change", syncRefVisibility);

    $("f-category").addEventListener("change", syncCategoryUI);
    $("f-members").addEventListener("change", syncAllMembersBox);

    $("f-all-members").addEventListener("change", (e) => {
      const on = e.target.checked;
      document
        .querySelectorAll('input[name="members"]')
        .forEach((el) => (el.checked = on));
      syncAllMembersBox();
    });

    $("btn-clear-activity").addEventListener("click", async () => {
      if (!confirm("更新履歴をすべて消します。企画そのものは消えません。")) return;
      try {
        await api("/api/activities", { method: "DELETE" });
        await renderActivities();
        toast("更新履歴を消しました");
      } catch (e) {
        toast(e.message);
      }
    });
  }

  function init() {
    loadFilters();
    buildFilters();

    buildMemberChecks();
    buildRadios(
      "f-category",
      "category",
      Object.entries(META.categories).map(([value, label]) => ({ value, label }))
    );
    buildRadios(
      "f-video-type",
      "video_type",
      Object.entries(META.video_types).map(([value, label]) => ({ value, label }))
    );

    bind();
    reload().catch((e) => toast(e.message));
  }

  init();
})();
