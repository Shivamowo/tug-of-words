(() => {
  const $ = id => document.getElementById(id);
  const A = window.Audio8;
  const S = { room: null, me: null, cid: null, name: "", offset: 0, joinCode: null, screen: "boot", lastPhase: null, cdShown: null, hurry: false, musicMode: null, promptIdx: -1 };

  // ---------- identity ----------
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  S.cid = store.get("tow_cid") || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
  store.set("tow_cid", S.cid);
  S.name = store.get("tow_name") || "";
  const m = location.pathname.match(/^\/r\/([A-Za-z]{5})/) || location.search.match(/[?&]r=([A-Za-z]{5})/);
  if (m) S.joinCode = m[1].toUpperCase();

  // ---------- background stars ----------
  (() => {
    const box = $("stars"); const glyphs = ["✦", "+", "·", "✕", "✦"];
    for (let i = 0; i < 38; i++) {
      const s = document.createElement("div");
      const g = glyphs[i % glyphs.length];
      s.className = "star" + (g === "✕" || g === "+" ? " x" : "");
      s.textContent = g;
      s.style.left = Math.random() * 100 + "vw"; s.style.top = Math.random() * 60 + "vh";
      s.style.fontSize = (g === "·" ? 22 : 8 + Math.random() * 16) + "px";
      s.style.animationDelay = Math.random() * 2.4 + "s";
      box.appendChild(s);
    }
  })();

  // ---------- pixel sprites ----------
  const SPR = [
    "....oooo....",
    "..oobbbboo..",
    ".obbbbbbbbo.",
    ".obbbbwkbwo.",
    "obbbbbwkbwko",
    "obbbbbbbbbbo",
    "obbbcbbbbcbo",
    ".obbbbbbbbo.",
    "..oobbbboo..",
    "...oo..oo..."
  ];
  const ACC = { cat: [[2, 0], [3, 0], [8, 0], [9, 0]], ghost: [], frog: [[3, 0], [8, 0]], bot: [[5, -1], [6, -1]], skull: [], blob: [] };
  function sprite(team, avatar = "blob", flip = false) {
    const body = team === "L" ? "#f7a9e8" : "#8f7bff";
    const cheek = team === "L" ? "#ff6fae" : "#c4b8ff";
    const col = { o: "#1b1930", b: body, w: "#ffffff", k: "#1b1930", c: cheek };
    let r = "";
    SPR.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const X = flip ? 11 - x : x;
      r += `<rect x="${X}" y="${y + 1}" width="1" height="1" fill="${col[ch]}"/>`;
    }));
    (ACC[avatar] || []).forEach(([x, y]) => { const X = flip ? 11 - x : x; r += `<rect x="${X}" y="${y + 1}" width="1" height="1" fill="#1b1930"/>`; });
    return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges">${r}</svg>`;
  }

  // ---------- screens ----------
  function show(id) {
    ["boot", "home", "lobby", "game"].forEach(s => $(s).classList.toggle("hidden", s !== id));
    S.screen = id;
    $("gameboy").style.display = id === "boot" || id === "home" ? "" : "none";
    const chat = $("chat");
    if (id === "lobby") $("lobby-chat-slot").appendChild(chat);
    if (id === "game") $("game-chat-slot").appendChild(chat);
    if (id === "lobby" || id === "game") {
      const which = id === "game" ? "game" : "lobby";
      if (S.logView !== which) {
        S.logView = which;
        $("log-lobby").classList.toggle("hidden", which !== "lobby");
        $("log-game").classList.toggle("hidden", which !== "game");
        $("jump").classList.add("hidden");
        requestAnimationFrame(() => { const l = activeLog(); l.style.scrollBehavior = "auto"; l.scrollTop = l.scrollHeight; l.style.scrollBehavior = ""; });
      }
    }
    document.body.classList.toggle("fast", id === "game");
    document.body.classList.toggle("in-game", id === "game");
    const ctl = $("audio-ctl");
    if (id === "game") { $("hud-ctl").appendChild(ctl); ctl.classList.add("in-hud"); }
    else if (ctl.classList.contains("in-hud")) { document.body.appendChild(ctl); ctl.classList.remove("in-hud"); }
    if (id === "game") fitViewport();
  }

  // ---------- viewport: follow mobile keyboard / browser bars ----------
  function fitViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-h", h + "px");
    document.body.classList.toggle("short", h < 560);
    const w = vv ? vv.width : window.innerWidth;
    document.body.classList.toggle("land", h < 520 && w > h * 1.3 && w >= 560);
    if (S.screen === "game") window.scrollTo(0, 0);
  }
  (window.visualViewport || window).addEventListener("resize", fitViewport);
  window.addEventListener("orientationchange", () => setTimeout(fitViewport, 250));
  fitViewport();
  function toast(t) {
    const el = $("toast"); el.textContent = t; el.classList.remove("hidden");
    A.sfx("error"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  // ---------- audio controls ----------
  function paintAudio() { $("btn-music").classList.toggle("off", !A.musicOn); $("btn-sfx").classList.toggle("off", !A.sfxOn); }
  $("btn-music").onclick = () => { A.unlock(); A.toggleMusic(); paintAudio(); };
  $("btn-sfx").onclick = () => { A.init(); A.toggleSfx(); paintAudio(); A.sfx("click"); };
  paintAudio();
  const unlock = () => A.unlock();
  ["pointerdown", "touchend", "keydown"].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));
  function music(mode) {
    if (S.musicMode === mode) return; S.musicMode = mode;
    if (mode === "none") A.stop(); else A.play(mode);
  }

  // ---------- boot ----------
  (() => {
    let p = 10; const bar = $("boot-bar"), pct = $("boot-pct");
    const it = setInterval(() => {
      p = Math.min(100, p + 6 + Math.floor(Math.random() * 14));
      bar.style.width = p + "%"; pct.textContent = p + "%";
      if (p >= 100) { clearInterval(it); $("boot-sub").textContent = "ready!"; $("btn-start").classList.remove("hidden"); }
    }, 130);
  })();
  $("btn-start").onclick = () => {
    A.unlock(); A.sfx("go"); music("lobby");
    show("home");
    $("in-name").value = S.name;
    if (S.joinCode) {
      $("btn-create").classList.add("hidden"); $("or-join").classList.add("hidden"); $("row-join").classList.add("hidden");
      const b = $("btn-joinlink"); b.classList.remove("hidden"); b.textContent = `JOIN ROOM ${S.joinCode} ▶`;
    }
    setTimeout(() => $("in-name").focus(), 50);
  };
  document.addEventListener("keydown", e => { if (S.screen === "boot" && e.key === "Enter" && !$("btn-start").classList.contains("hidden")) $("btn-start").click(); });

  // ---------- socket ----------
  const socket = io({ transports: ["websocket", "polling"] });
  function needName() {
    const n = $("in-name").value.trim();
    if (!n) { toast("ENTER A NAME"); $("in-name").focus(); return null; }
    S.name = n; store.set("tow_name", n); return n;
  }
  $("btn-create").onclick = () => { const n = needName(); if (!n) return; A.sfx("click"); socket.emit("create", { name: n, cid: S.cid }); };
  const doJoin = code => { const n = needName(); if (!n) return; if (!/^[A-Za-z]{5}$/.test(code || "")) return toast("5-LETTER CODE"); A.sfx("click"); socket.emit("join", { code: code.toUpperCase(), name: n, cid: S.cid }); };
  $("btn-join").onclick = () => doJoin($("in-code").value.trim());
  $("btn-joinlink").onclick = () => doJoin(S.joinCode);
  $("in-name").addEventListener("keydown", e => { if (e.key === "Enter") (S.joinCode ? $("btn-joinlink") : $("btn-create")).click(); });
  $("in-code").addEventListener("keydown", e => { if (e.key === "Enter") $("btn-join").click(); });

  socket.on("err", t => toast(String(t).toUpperCase()));
  socket.on("joined", ({ code }) => {
    S.joinCode = code;
    history.replaceState(null, "", `/r/${code}`);
    $("log-lobby").innerHTML = ""; $("log-game").innerHTML = "";
  });
  socket.on("connect", () => {
    // auto-rejoin after reconnect
    if (S.room && S.name) socket.emit("join", { code: S.room.code, name: S.name, cid: S.cid });
  });

  socket.on("room", r => {
    S.offset = r.now - Date.now();
    const prev = S.room; S.room = r;
    S.me = r.players.find(p => p.cid === S.cid) || null;
    render(prev);
  });

  // ---------- render ----------
  function render(prev) {
    const r = S.room; if (!r) return;
    if (r.phase === "lobby") { show("lobby"); renderLobby(); music("lobby"); $("over").classList.add("hidden"); }
    else if (r.phase === "countdown" || r.phase === "playing") {
      if (S.screen !== "game") { show("game"); }
      $("over").classList.add("hidden");
      renderGame(prev);
      if (r.phase === "playing") music("battle"); else music("none");
    } else if (r.phase === "over") { show("game"); renderGame(prev); renderLobby(); }
    S.lastPhase = r.phase;
    const input = $("in-msg");
    input.placeholder = r.phase === "playing" ? "type your move… (enter)" : "chat…";
  }

  function renderLobby() {
    const r = S.room;
    $("lobby-code").textContent = r.code;
    for (const t of ["L", "R"]) {
      const el = $("team-" + t); el.innerHTML = "";
      r.players.filter(p => p.team === t).forEach(p => {
        const d = document.createElement("div"); d.className = "pl" + (p.online ? "" : " off");
        d.innerHTML = sprite(t, p.avatar, t === "R");
        const nm = document.createElement("span"); nm.textContent = p.name; d.appendChild(nm);
        if (p.cid === r.hostCid) { const tg = document.createElement("span"); tg.className = "tag"; tg.textContent = "HOST"; d.appendChild(tg); }
        if (p.cid === S.cid) { const tg = document.createElement("span"); tg.className = "tag"; tg.style.background = "var(--white)"; tg.textContent = "YOU"; d.appendChild(tg); }
        el.appendChild(d);
      });
      if (!r.players.some(p => p.team === t)) el.innerHTML = `<div class="muted">waiting for a challenger…</div>`;
    }
    const isHost = r.hostCid === S.cid;
    const L = r.players.filter(p => p.team === "L").length, R = r.players.filter(p => p.team === "R").length;
    const go = $("btn-go");
    go.classList.toggle("hidden", !isHost);
    go.disabled = !(L && R);
    $("lobby-hint").textContent = !(L && R) ? "SHARE THE LINK — NEED 1 PLAYER PER TEAM" : isHost ? "READY WHEN YOU ARE" : "WAITING FOR HOST TO START…";
  }
  $("btn-copy").onclick = async () => {
    const url = `${location.origin}/r/${S.room.code}`;
    try { await navigator.clipboard.writeText(url); $("btn-copy").textContent = "COPIED!"; } catch { prompt("Copy this link", url); }
    A.sfx("click"); setTimeout(() => $("btn-copy").textContent = "COPY LINK", 1500);
  };
  $("btn-switch").onclick = () => { A.sfx("click"); socket.emit("switchTeam"); };
  $("btn-go").onclick = () => { A.sfx("click"); socket.emit("start"); };
  $("btn-rematch").onclick = () => { A.sfx("click"); socket.emit("start"); };
  $("btn-lobby").onclick = () => { A.sfx("click"); socket.emit("toLobby"); };

  function renderGame(prev) {
    const r = S.room;
    if (r.phase === "countdown" && prev?.phase !== "countdown") { S.cdShown = null; $("log-game").innerHTML = ""; S.heartAt = 0; S.final10 = false; S.hurry = false; S.promptIdx = -1; S.lastTick = null; }
    // sides
    for (const t of ["L", "R"]) {
      const side = $("side-" + t);
      const ps = r.players.filter(p => p.team === t).slice(0, 5);
      const sig = ps.map(p => p.avatar).join(",");
      if (side.dataset.sig !== sig) { side.dataset.sig = sig; side.innerHTML = ps.map(p => sprite(t, p.avatar, t === "R")).join(""); }
    }
    setRope(r.rope);
    // prompt
    if (r.prompt && r.promptIdx !== S.promptIdx) {
      S.promptIdx = r.promptIdx;
      $("prompt-text").textContent = r.prompt;
      $("prompt-step").textContent = `PROMPT ${r.promptIdx + 1}/4`;
      const pb = $("prompt-box"); pb.classList.remove("flip"); void pb.offsetWidth; pb.classList.add("flip");
    }
    // event
    const ev = $("event");
    if (r.event) { ev.classList.remove("hidden"); $("event-label").textContent = "⚠ " + r.event.label + " ⚠"; ev.dataset.until = r.event.until; }
    else ev.classList.add("hidden");
    // jev indicator
    $("jev-ind").classList.toggle("mock", !r.jevLive);
    $("jev-label").textContent = r.jevLive ? "JEV LIVE" : "JEV MOCK";
    // countdown overlay
    if (r.phase === "playing" && prev?.phase === "countdown") setTimeout(() => $("in-msg").focus(), 30);
  }

  const ropeFx = { target: 0, shown: 0, vel: 0 };
  function setRope(v) { ropeFx.target = v; }
  function drawRope() {
    // critically-damped-ish spring toward target: smooth, with a little overshoot
    const k = 0.09, damp = 0.78;
    ropeFx.vel = (ropeFx.vel + (ropeFx.target - ropeFx.shown) * k) * damp;
    ropeFx.shown += ropeFx.vel;
    if (Math.abs(ropeFx.target - ropeFx.shown) < 0.01 && Math.abs(ropeFx.vel) < 0.01) { ropeFx.shown = ropeFx.target; ropeFx.vel = 0; }
    const v = ropeFx.shown;
    const arena = $("arena"); const w = arena.clientWidth;
    const tilt = Math.max(-18, Math.min(18, ropeFx.vel * 6));
    $("knot").style.transform = `translate3d(${(v * 0.36 / 100) * w}px,0,0) rotate(${tilt}deg)`;
    $("mL").style.transform = `scaleX(${(50 - v / 2) / 100})`;
    $("mR").style.transform = `scaleX(${(50 + v / 2) / 100})`;
    $("rope").style.backgroundPosition = `${v * 3}px 0`;
    const drag = w * 0.0009;
    $("side-L").style.transform = `translate3d(${Math.max(0, v) * drag}px,0,0) rotate(${Math.max(0, v) * 0.12}deg)`;
    $("side-R").style.transform = `translate3d(${Math.min(0, v) * drag}px,0,0) rotate(${Math.min(0, v) * 0.12}deg)`;
    arena.style.setProperty("--danger-L", Math.max(0, (-v - 55) / 45));
    arena.style.setProperty("--danger-R", Math.max(0, (v - 55) / 45));
  }

  // ---------- frame loop: timers ----------
  function showGo() {
    S.goUntil = Date.now() + 700;
    const cd = $("countdown"), n = $("cd-n");
    cd.classList.remove("hidden"); n.textContent = "GO!"; n.style.animation = "none"; void n.offsetWidth; n.style.animation = "";
  }
  function fmt(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  function loop() {
    const r = S.room;
    if (r) {
      const now = Date.now() + S.offset;
      if (r.phase === "countdown") {
        const left = Math.ceil((r.startsAt - now) / 1000);
        const cd = $("countdown");
        const label = left > 3 ? "3" : left >= 1 ? String(left) : "GO!";
        cd.classList.remove("hidden");
        if (S.cdShown !== label) { S.cdShown = label; const n = $("cd-n"); n.textContent = label; n.style.animation = "none"; void n.offsetWidth; n.style.animation = ""; A.sfx(label === "GO!" ? "go" : "count"); }
        if (S.tt !== "2:00") { S.tt = "2:00"; $("timer").textContent = "2:00"; }
      } else if (!(S.goUntil > Date.now())) {
        $("countdown").classList.add("hidden");
      }
      if (r.phase === "playing") {
        const left = r.endsAt - now;
        const tt = fmt(left); if (S.tt !== tt) { S.tt = tt; $("timer").textContent = tt; }
        const hurry = left < 20000;
        $("timer").classList.toggle("hurry", hurry);
        if (hurry && !S.hurry) { S.hurry = true; A.speedUp(178); }
        if (left < 10000 && left > 0 && !S.final10) { S.final10 = true; banner("FINAL 10!", "final"); A.sfx("event"); }
        const danger = Math.abs(ropeFx.shown);
        if (danger > 70 && Date.now() > (S.heartAt || 0)) { S.heartAt = Date.now() + (danger > 88 ? 450 : 750); A.sfx("heart"); }
        if (hurry && left > 0) { const sec = Math.ceil(left / 1000); if (sec <= 5 && S.lastTick !== sec) { S.lastTick = sec; A.sfx("tick"); } }
      }
      const ev = $("event");
      if (!ev.classList.contains("hidden")) {
        const until = +ev.dataset.until; const frac = Math.max(0, (until - now) / 8000);
        $("event-bar").style.width = frac * 100 + "%";
      }
    }
    if (S.screen === "game") drawRope();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- chat (separate lobby + match logs) ----------
  const activeLog = () => $(S.logView === "game" ? "log-game" : "log-lobby");
  const atBottom = l => l.scrollHeight - l.scrollTop - l.clientHeight < 60;
  function toBottom(l, smooth = true) {
    l.scrollTo({ top: l.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    if (l === activeLog()) $("jump").classList.add("hidden");
  }
  function pushTo(l, el, forceScroll) {
    const stick = atBottom(l);
    l.appendChild(el);
    while (l.children.length > 150) l.firstChild.remove();
    if (stick || forceScroll) toBottom(l, true);
    else if (l === activeLog()) $("jump").classList.remove("hidden");
  }
  $("jump").onclick = () => { A.sfx("click"); toBottom(activeLog()); };
  ["log-lobby", "log-game"].forEach(id => $(id).addEventListener("scroll", e => { if (e.target === activeLog() && atBottom(e.target)) $("jump").classList.add("hidden"); }, { passive: true }));
  const inMatch = () => S.room && (S.room.phase === "playing" || S.room.phase === "countdown");

  socket.on("chat", m => {
    const d = document.createElement("div");
    d.id = "msg-" + m.id;
    let target;
    if (m.kind === "sys") { d.className = "msg sys " + (m.tone || ""); d.textContent = m.text; target = inMatch() ? $("log-game") : $("log-lobby"); }
    else {
      d.className = `msg ${m.team}` + (m.cid === S.cid ? " me" : "");
      const who = document.createElement("div"); who.className = "who"; who.textContent = m.name;
      const txt = document.createElement("div"); txt.className = "txt"; txt.textContent = m.text;
      d.append(who, txt);
      if (m.pending) { const v = document.createElement("div"); v.className = "verdict"; v.innerHTML = `<span class="thinking">jev judging</span>`; d.appendChild(v); }
      if (m.cid !== S.cid) A.sfx("recv");
      target = m.kind === "move" ? $("log-game") : $("log-lobby");
      hideTyping(m.cid, m.team);
    }
    pushTo(target, d, m.cid === S.cid);
  });

  // ---------- typing indicators ----------
  const typing = new Map(); // cid -> {name, team, until}
  let lastTypingEmit = 0;
  $("in-msg").addEventListener("input", () => {
    const now = Date.now();
    if (now - lastTypingEmit > 700 && $("in-msg").value.trim()) { lastTypingEmit = now; socket.emit("typing"); }
  });
  socket.on("typing", t => { typing.set(t.cid, { ...t, until: Date.now() + 1800 }); paintTyping(); });
  function hideTyping(cid) { if (typing.delete(cid)) paintTyping(); }
  function paintTyping() {
    const now = Date.now();
    for (const [k, v] of typing) if (v.until < now) typing.delete(k);
    const names = [...typing.values()].map(v => v.name);
    $("typing-line").textContent = names.length ? `${names.slice(0, 2).join(", ")}${names.length > 2 ? " +" + (names.length - 2) : ""} ${names.length > 1 ? "are" : "is"} typing…` : "\u00a0";
    for (const t of ["L", "R"]) $("dots-" + t).classList.toggle("hidden", !(S.screen === "game" && [...typing.values()].some(v => v.team === t)));
  }
  setInterval(paintTyping, 500);

  // ---------- arena flavour ----------
  function sayBubble(team, text, pull) {
    const el = $("say-" + team);
    el.textContent = text.length > 42 ? text.slice(0, 40) + "…" : text;
    el.classList.remove("hidden", "pop", "neg"); void el.offsetWidth; el.classList.add("pop");
    if (pull < 0) el.classList.add("neg");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.add("hidden"), 2200);
  }
  function dust(team) {
    const arena = $("arena"), side = $("side-" + team);
    const r = side.getBoundingClientRect(), a = arena.getBoundingClientRect();
    for (let i = 0; i < 7; i++) {
      const p = document.createElement("i"); p.className = "dust";
      p.style.left = (r.left - a.left + r.width / 2 + (Math.random() - .5) * r.width * .6) + "px";
      p.style.top = (r.bottom - a.top - 6) + "px";
      p.style.setProperty("--dx", ((team === "L" ? -1 : 1) * (10 + Math.random() * 30)) + "px");
      p.style.setProperty("--dy", (-8 - Math.random() * 22) + "px");
      arena.appendChild(p); setTimeout(() => p.remove(), 700);
    }
  }
  function burst(team, emojis) {
    const arena = $("arena");
    emojis.forEach((e, i) => setTimeout(() => {
      const el = document.createElement("div"); el.className = "emo"; el.textContent = e;
      el.style.left = (team === "L" ? 10 + Math.random() * 30 : 60 + Math.random() * 30) + "%";
      arena.appendChild(el); setTimeout(() => el.remove(), 1900);
    }, i * 120));
  }
  function banner(text, cls = "") {
    const el = document.createElement("div"); el.className = "banner " + cls; el.textContent = text;
    $("arena").appendChild(el); setTimeout(() => el.remove(), 1500);
  }
  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  socket.on("judged", j => {
    const d = document.getElementById("msg-" + j.id);
    const gl = $("log-game"), stick = atBottom(gl);
    if (d) {
      const v = d.querySelector(".verdict") || d.appendChild(document.createElement("div"));
      v.className = "verdict done"; v.innerHTML = "";
      const stars = document.createElement("span"); stars.className = "stars";
      const q = Math.round(j.quality); stars.textContent = "★".repeat(q) + "☆".repeat(4 - q); stars.title = `quality ${j.quality}/4`;
      const pull = document.createElement("span"); pull.className = "pull" + (j.pull < 0 ? " neg" : "");
      pull.textContent = (j.pull >= 0 ? "+" : "") + j.pull.toFixed(1);
      v.append(pull, stars);
      j.tags.forEach((t, i) => { const c = document.createElement("span"); c.className = "chip " + t.c; c.style.animationDelay = (80 + i * 70) + "ms"; c.textContent = t.t; v.appendChild(c); });
      d.classList.add(j.pull < 0 ? "hit-bad" : j.outcome === "crit" ? "hit-crit" : "hit");
      if (stick) toBottom(gl);
    }
    // rope + fx
    const prevRope = S.room ? S.room.rope : 0;
    if (S.room) S.room.rope = j.rope;
    setRope(j.rope);
    const side = $("side-" + j.team); side.classList.remove("yank"); void side.offsetWidth; if (j.pull > 0) side.classList.add("yank");
    floatText(j);
    const mine = S.me && j.team === S.me.team;
    const txtEl = d && d.querySelector(".txt");
    if (txtEl) sayBubble(j.team, txtEl.textContent, j.pull);
    if (j.pull > 0) dust(j.team);
    $("side-" + j.team).classList.toggle("onfire", (j.streak || 0) >= 3);
    if (j.pull <= 0) $("side-" + j.team).classList.remove("onfire");
    if (j.outcome === "crit") {
      const ar = $("arena"); ar.classList.remove("pop"); void ar.offsetWidth; ar.classList.add("pop");
      burst(j.team, ["😱", "🔥", "💥"]); buzz(mine ? 35 : [20, 40, 20]);
    } else if (!mine && j.pull > 8) buzz(15);
    if ((j.streak || 0) >= 3) setTimeout(() => A.sfx("streak"), 160);
    const o = j.outcome;
    if (o === "crit") { A.sfx("crit"); shake(); }
    else if (o === "whiff") A.sfx("whiff");
    else if (o === "spam") A.sfx("spam");
    else if (o === "broke") A.sfx("broke");
    else if (o === "fizzle") A.sfx("fizzle");
    else if (j.tags.some(t => t.c === "combo")) A.sfx("combo");
    else if (j.tags.some(t => t.c === "lol")) A.sfx("lol");
    else A.sfx(mine ? "pull" : "pullThem");
    if (j.tags.some(t => t.t === "RULE ✓")) setTimeout(() => A.sfx("ruleOk"), 120);
  });

  function floatText(j) {
    const arena = $("arena");
    const f = document.createElement("div");
    f.className = "float" + (j.outcome === "crit" ? " crit" : "");
    const pct = 50 + j.rope * 0.36;
    f.style.left = pct + "%"; f.style.top = "20px";
    const label = { crit: "CRIT!", whiff: "whiff", spam: "SPAM!", broke: "RULE!", fizzle: "fizzle" }[j.outcome];
    f.textContent = (label ? label + " " : "") + (j.pull >= 0 ? "+" : "") + Math.round(j.pull);
    f.style.color = j.pull < 0 ? "var(--bad)" : j.team === "L" ? "var(--L)" : "var(--R)";
    arena.appendChild(f); setTimeout(() => f.remove(), 1200);
  }
  function shake() { document.body.classList.remove("shake"); void document.body.offsetWidth; document.body.classList.add("shake"); setTimeout(() => document.body.classList.remove("shake"), 320); }

  // composer
  function send() {
    const inp = $("in-msg"); const t = inp.value.trim(); if (!t) return;
    socket.emit("msg", t); inp.value = ""; A.sfx("send");
    if (S.room?.phase === "playing") {
      const c = $("cool"), b = $("cool-bar"); c.classList.remove("hidden");
      b.style.transition = "none"; b.style.width = "0%"; void b.offsetWidth;
      b.style.transition = "width 1s steps(10)"; b.style.width = "100%";
    }
  }
  $("btn-send").onclick = send;
  $("in-msg").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); send(); } else if (e.key.length === 1) A.sfx("type"); });
  socket.on("cooldown", () => { const c = $("cool"); c.style.boxShadow = "0 0 0 3px var(--bad)"; setTimeout(() => c.style.boxShadow = "", 300); A.sfx("error"); });

  // emotes (no-effort chat)
  const EMO = ["😂", "💀", "🔥", "🤡", "😭", "👀", "💪", "🫡"];
  EMO.forEach(e => { const b = document.createElement("button"); b.textContent = e; b.onclick = () => socket.emit("emote", e); $("emotes").appendChild(b); });
  socket.on("emote", ({ e, team, name }) => {
    A.sfx("emote");
    const host = S.screen === "game" ? $("arena") : $("chat");
    const el = document.createElement("div"); el.className = "emo"; el.textContent = e; el.title = name;
    el.style.left = (team === "L" ? 8 + Math.random() * 30 : 62 + Math.random() * 30) + "%";
    host.style.position = "relative"; host.appendChild(el); setTimeout(() => el.remove(), 1700);
  });

  // fx
  socket.on("fx", f => {
    if (f.type === "flip") { A.sfx("flip"); sysLine(`NEW PROMPT: ${f.prompt}`, "flip"); }
    if (f.type === "event") { A.sfx("event"); shake(); buzz([30, 60, 30]); sysLine(`⚠ ${f.label} ⚠`, "flip"); }
    if (f.type === "join") A.sfx("join");
    if (f.type === "go") { A.sfx("go"); showGo(); }
  });
  function sysLine(text, tone) {
    const d = document.createElement("div"); d.className = "msg sys " + (tone || ""); d.textContent = text; pushTo($("log-game"), d, true);
  }

  // ---------- game over ----------
  socket.on("over", o => {
    const r = S.room;
    music("none");
    const myTeam = S.me?.team;
    const teamName = t => t === "L" ? "PINK" : "PURPLE";
    let title, sub;
    if (o.winner === "draw") { title = "DRAW"; sub = "PERFECTLY BALANCED"; A.sfx("lose"); }
    else if (o.winner === myTeam) { title = "YOU WIN"; sub = `TEAM ${teamName(o.winner)} ${o.reason === "knockout" ? "K.O.!" : "ON TIME"}`; A.sfx("win"); confetti(); }
    else { title = "YOU LOSE"; sub = `TEAM ${teamName(o.winner)} ${o.reason === "knockout" ? "K.O.!" : "ON TIME"}`; A.sfx("lose"); }
    $("res-title").textContent = title; $("res-sub").textContent = sub;
    const stats = $("res-stats"); stats.innerHTML = "";
    const me = r?.players.find(p => p.cid === S.cid);
    const add = (k, v) => { const d = document.createElement("div"); d.className = "stat"; d.innerHTML = `<div class="k"></div><div class="v"></div>`; d.querySelector(".k").textContent = k; d.querySelector(".v").textContent = v; stats.appendChild(d); };
    if (o.mvp) add("MVP", `${o.mvp.name} (${o.mvp.pull})`);
    if (me) { add("YOUR PULL", Math.round(me.stats.pull)); add("LINES", me.stats.msgs); add("CRITS", me.stats.crits); add("LOLS", me.stats.lols); add("COMBOS", me.stats.combos); if (me.stats.bestStreak >= 3) add("BEST STREAK", "🔥 " + me.stats.bestStreak); }
    const q = (el, label, line) => {
      el.innerHTML = ""; if (!line) { el.classList.add("hidden"); return; } el.classList.remove("hidden");
      const s = document.createElement("small"); s.textContent = label; el.appendChild(s);
      el.appendChild(document.createTextNode(`“${line.text}” — ${line.name}`));
    };
    q($("res-best"), "STRONGEST LINE", o.bestLine && { ...o.bestLine, text: `${o.bestLine.text}  (+${Math.round(o.bestLine.pull)})` });
    q($("res-funny"), "JEV'S FAVORITE JOKE", o.funniest && o.funniest.funny > 0.5 ? o.funniest : null);
    const isHost = r?.hostCid === S.cid;
    $("btn-rematch").classList.toggle("hidden", !isHost);
    $("btn-lobby").classList.toggle("hidden", !isHost);
    $("res-hint").textContent = isHost ? "" : "WAITING FOR HOST…";
    setTimeout(() => $("over").classList.remove("hidden"), 700);
    setTimeout(() => music("lobby"), 3500);
  });

  function confetti() {
    const cols = ["#f7a9e8", "#8f7bff", "#ffe066", "#ffffff", "#7dffb0"];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement("div"); c.className = "confetti";
      c.style.left = Math.random() * 100 + "vw"; c.style.background = cols[i % cols.length];
      c.style.animationDuration = 1.6 + Math.random() * 1.8 + "s"; c.style.animationDelay = Math.random() * 0.6 + "s";
      document.body.appendChild(c); setTimeout(() => c.remove(), 4200);
    }
  }

  // mount chat into lobby initially (hidden until a room exists)
  $("lobby-chat-slot").appendChild($("chat"));
})();
