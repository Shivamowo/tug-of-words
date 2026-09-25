import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { judge, jevStatus } from "./jev.js";
import { PROMPT_CHAINS, EVENTS, checkDeterministic } from "./content.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---- tunables ----
const MATCH_MS = Number(process.env.MATCH_MS || 120_000);
const PROMPT_EVERY_MS = MATCH_MS / 4;
const TSCALE = MATCH_MS / 120_000;
const COUNTDOWN_MS = 3_500;
const EVENT_MS = Number(process.env.EVENT_MS || 8_000);
const COOLDOWN_MS = 1_000;
const MAX_INFLIGHT = 3;
const MAX_LEN = 140;
const MAX_PLAYERS = 10;
const WIN_AT = 100;

const app = express();
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/health", (_q, r) => r.json({ ok: true, rooms: rooms.size, jev: { live: jevStatus.live, calls: jevStatus.calls, fails: jevStatus.fails, lastMs: jevStatus.lastMs, lastError: jevStatus.lastError } }));
app.get("/r/:code", (_q, r) => r.sendFile(path.join(__dirname, "public", "index.html")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, pingInterval: 10_000, pingTimeout: 20_000 });

/** @type {Map<string, any>} */
const rooms = new Map();
const sockIndex = new Map(); // socket.id -> { code, cid }

const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const AVATARS = ["blob", "cat", "ghost", "frog", "bot", "skull"];

function makeCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let c;
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(""); } while (rooms.has(c));
  return c;
}

function newRoom(hostCid) {
  const room = {
    code: makeCode(), hostCid, players: new Map(), phase: "lobby",
    rope: 0, startsAt: 0, endsAt: 0, prompts: [], promptIdx: 0, event: null,
    lastByTeam: { L: null, R: null }, timers: [], msgSeq: 0, lines: [], winner: null, createdAt: Date.now()
  };
  rooms.set(room.code, room);
  return room;
}

function teamCounts(room) {
  let L = 0, R = 0;
  for (const p of room.players.values()) p.team === "L" ? L++ : R++;
  return { L, R };
}

function publicRoom(room) {
  return {
    code: room.code, hostCid: room.hostCid, phase: room.phase, rope: room.rope,
    startsAt: room.startsAt, endsAt: room.endsAt, now: Date.now(),
    prompt: room.prompts[room.promptIdx] || null, promptIdx: room.promptIdx,
    event: room.event ? { id: room.event.id, label: room.event.label, until: room.event.until } : null,
    winner: room.winner, jevLive: !!process.env.TYPESAFE_API_KEY,
    players: [...room.players.values()].map(p => ({ cid: p.cid, name: p.name, team: p.team, avatar: p.avatar, online: p.online, stats: p.stats }))
  };
}
const broadcast = room => io.to(room.code).emit("room", publicRoom(room));
const sys = (room, text, tone = "info") => io.to(room.code).emit("chat", { id: `s${++room.msgSeq}`, kind: "sys", text, tone, at: Date.now() });

function clearTimers(room) { room.timers.forEach(clearTimeout); room.timers = []; }
function later(room, ms, fn) { room.timers.push(setTimeout(fn, ms)); }

function freshStats() { return { msgs: 0, pull: 0, crits: 0, whiffs: 0, lols: 0, combos: 0, best: null, streak: 0, bestStreak: 0 }; }

// ---------------- match lifecycle ----------------
function startMatch(room) {
  clearTimers(room);
  const chains = shuffle(PROMPT_CHAINS).slice(0, 2);
  room.prompts = [...chains[0], ...chains[1]];
  room.promptIdx = 0; room.rope = 0; room.event = null; room.winner = null;
  room.lastByTeam = { L: null, R: null }; room.lines = [];
  for (const p of room.players.values()) { p.stats = freshStats(); p.recent = []; p.inflight = 0; p.lastAt = 0; }
  room.phase = "countdown";
  room.startsAt = Date.now() + COUNTDOWN_MS;
  room.endsAt = room.startsAt + MATCH_MS;
  broadcast(room);

  later(room, COUNTDOWN_MS, () => {
    room.phase = "playing";
    broadcast(room);
    io.to(room.code).emit("fx", { type: "go" });
  });
  for (let i = 1; i < 4; i++) {
    later(room, COUNTDOWN_MS + PROMPT_EVERY_MS * i, () => {
      if (room.phase !== "playing") return;
      room.promptIdx = i;
      room.lastByTeam = { L: null, R: null };
      broadcast(room);
      io.to(room.code).emit("fx", { type: "flip", prompt: room.prompts[i] });
    });
  }
  // events: 4 windows, last one always a modifier for a chaotic finale
  const rules = shuffle(EVENTS.filter(e => e.kind === "rule"));
  const mods = shuffle(EVENTS.filter(e => e.kind === "mod"));
  const plan = [rules[0], rules[1], rules[2], mods[0]];
  const windows = [[14, 22], [42, 52], [70, 80], [100, 106]];
  plan.forEach((ev, i) => {
    const [a, b] = windows[i];
    const at = COUNTDOWN_MS + (a + Math.random() * (b - a)) * 1000 * TSCALE;
    later(room, at, () => {
      if (room.phase !== "playing") return;
      room.event = { ...ev, until: Date.now() + EVENT_MS };
      broadcast(room);
      io.to(room.code).emit("fx", { type: "event", label: ev.label });
      later(room, EVENT_MS, () => { if (room.event?.id === ev.id) { room.event = null; broadcast(room); } });
    });
  });
  later(room, COUNTDOWN_MS + MATCH_MS, () => endMatch(room, "time"));
}

function endMatch(room, reason) {
  if (room.phase !== "playing" && room.phase !== "countdown") return;
  clearTimers(room);
  room.phase = "over";
  room.event = null;
  room.winner = room.rope <= -WIN_AT ? "L" : room.rope >= WIN_AT ? "R" : Math.abs(room.rope) < 1 ? "draw" : room.rope < 0 ? "L" : "R";
  const players = [...room.players.values()];
  const mvp = players.slice().sort((a, b) => b.stats.pull - a.stats.pull)[0];
  const bestLine = room.lines.slice().sort((a, b) => b.pull - a.pull)[0] || null;
  const funniest = room.lines.slice().sort((a, b) => b.funny - a.funny)[0] || null;
  broadcast(room);
  io.to(room.code).emit("over", {
    winner: room.winner, reason, rope: room.rope,
    mvp: mvp ? { cid: mvp.cid, name: mvp.name, pull: Math.round(mvp.stats.pull) } : null,
    bestLine, funniest
  });
}

// ---------------- scoring ----------------
async function handleMove(room, p, text) {
  const id = `m${++room.msgSeq}`;
  const oppTeam = p.team === "L" ? "R" : "L";
  const opponentLast = room.lastByTeam[oppTeam];
  const prompt = room.prompts[room.promptIdx];
  const ev = room.event && room.event.until > Date.now() ? room.event : null;
  const dup = p.recent.some(r => r.toLowerCase() === text.toLowerCase());

  io.to(room.code).emit("chat", { id, kind: "move", cid: p.cid, name: p.name, team: p.team, avatar: p.avatar, text, pending: true, at: Date.now() });

  const state = { prompt, message: text, my_recent: p.recent.slice(-3) };
  if (opponentLast) state.opponent_last = opponentLast;
  p.recent.push(text); if (p.recent.length > 6) p.recent.shift();
  room.lastByTeam[p.team] = text;

  p.inflight++;
  let j;
  try { j = await judge(state, { hasOpponent: !!opponentLast, ruleJev: ev?.kind === "rule" && ev.jev ? ev.jev : null }); }
  finally { p.inflight--; }
  if (room.phase !== "playing") return; // match ended while judging

  const tags = [];
  let pull = 2 + j.quality * 10;
  let outcome = "normal";

  const isSpam = dup || j.spam > 0.6;
  if (isSpam) {
    pull = -5; outcome = "spam"; tags.push({ t: "SPAM", c: "bad" });
  } else if (j.offtopic > 0.7 && j.funny < 0.6) {
    pull = 0; outcome = "fizzle"; tags.push({ t: "FIZZLE", c: "meh" });
  } else {
    if (j.funny > 0.6) { pull += 4; tags.push({ t: `LOL ${Math.round(j.funny * 100)}%`, c: "lol" }); p.stats.lols++; }
    if (j.counter != null && j.counter > 0.6) { pull *= 1.5; tags.push({ t: "COMBO x1.5", c: "combo" }); p.stats.combos++; }
    // rule events
    if (ev?.kind === "rule") {
      const ok = ev.check ? checkDeterministic(ev.check, text) : (j.rule ?? 0) > 0.5;
      if (ok) { pull += 3; tags.push({ t: "RULE ✓", c: "good" }); }
      else { pull = -6; outcome = "broke"; tags.push({ t: "RULE BROKEN", c: "bad" }); }
    }
    if (outcome === "normal") {
      const roll = Math.random();
      const critChance = ev?.id === "crit" ? 0.4 : 0.12;
      if (roll < 0.12) { pull *= 0.25; outcome = "whiff"; tags.push({ t: "WHIFF", c: "meh" }); p.stats.whiffs++; }
      else if (roll > 1 - critChance) { pull *= 2; outcome = "crit"; tags.push({ t: "CRIT x2", c: "crit" }); p.stats.crits++; }
      else pull *= 0.85 + Math.random() * 0.3;
      if (ev?.id === "double") { pull *= 2; tags.push({ t: "DOUBLE", c: "crit" }); }
    }
  }
  // hot streak: consecutive solid lines stack a bonus (x1.1 per line after the 2nd, max x1.4)
  const solid = pull > 0 && (outcome === "normal" || outcome === "crit");
  p.stats.streak = solid ? p.stats.streak + 1 : 0;
  p.stats.bestStreak = Math.max(p.stats.bestStreak, p.stats.streak);
  if (p.stats.streak >= 3) {
    pull *= Math.min(1.4, 1 + 0.1 * (p.stats.streak - 2));
    tags.push({ t: `🔥 STREAK x${p.stats.streak}`, c: "streak" });
  }
  // balance uneven teams
  const counts = teamCounts(room);
  pull = pull / Math.sqrt(Math.max(1, counts[p.team]));
  pull = Math.round(pull * 10) / 10;

  const dir = p.team === "L" ? -1 : 1;
  room.rope = Math.round(Math.max(-WIN_AT, Math.min(WIN_AT, room.rope + dir * pull)) * 10) / 10;
  p.stats.msgs++; p.stats.pull += pull;
  if (!p.stats.best || pull > p.stats.best.pull) p.stats.best = { text, pull };
  room.lines.push({ name: p.name, team: p.team, text, pull, funny: j.funny });

  io.to(room.code).emit("judged", {
    id, cid: p.cid, team: p.team, pull, outcome, tags,
    quality: Math.round(j.quality * 4 * 10) / 10, source: j.source, rope: room.rope, streak: p.stats.streak
  });
  if (Math.abs(room.rope) >= WIN_AT) endMatch(room, "knockout");
}

// ---------------- sockets ----------------
io.on("connection", socket => {
  const bind = (room, p) => {
    sockIndex.set(socket.id, { code: room.code, cid: p.cid });
    p.sid = socket.id; p.online = true;
    socket.join(room.code);
    socket.emit("joined", { code: room.code, cid: p.cid });
    broadcast(room);
  };

  function addPlayer(room, cid, name) {
    const existing = room.players.get(cid);
    if (existing) { existing.name = name || existing.name; return existing; }
    if (room.players.size >= MAX_PLAYERS) return null;
    const { L, R } = teamCounts(room);
    const p = {
      cid, name, team: L <= R ? "L" : "R",
      avatar: AVATARS[room.players.size % AVATARS.length],
      online: true, stats: freshStats(), recent: [], inflight: 0, lastAt: 0
    };
    room.players.set(cid, p);
    return p;
  }

  socket.on("create", ({ name, cid } = {}) => {
    name = clean(name, 16); cid = clean(cid, 40);
    if (!name || !cid) return socket.emit("err", "Name required");
    const room = newRoom(cid);
    const p = addPlayer(room, cid, name);
    bind(room, p);
    sys(room, `${name} created the room`);
  });

  socket.on("join", ({ code, name, cid } = {}) => {
    code = clean(code, 5).toUpperCase(); name = clean(name, 16); cid = clean(cid, 40);
    const room = rooms.get(code);
    if (!room) return socket.emit("err", "Room not found");
    if (!name || !cid) return socket.emit("err", "Name required");
    const wasIn = room.players.has(cid);
    if (!wasIn && room.phase !== "lobby" && room.phase !== "over") return socket.emit("err", "Match in progress — wait for it to end");
    const p = addPlayer(room, cid, name);
    if (!p) return socket.emit("err", "Room is full");
    bind(room, p);
    if (!wasIn) { sys(room, `${name} joined team ${p.team === "L" ? "PINK" : "PURPLE"}`, "join"); io.to(room.code).emit("fx", { type: "join" }); }
  });

  const ctx = () => {
    const s = sockIndex.get(socket.id);
    if (!s) return {};
    const room = rooms.get(s.code);
    return { room, p: room?.players.get(s.cid) };
  };

  socket.on("switchTeam", () => {
    const { room, p } = ctx();
    if (!room || !p || room.phase === "playing" || room.phase === "countdown") return;
    p.team = p.team === "L" ? "R" : "L";
    broadcast(room);
  });

  socket.on("start", () => {
    const { room, p } = ctx();
    if (!room || !p || p.cid !== room.hostCid) return;
    if (room.phase === "playing" || room.phase === "countdown") return;
    const { L, R } = teamCounts(room);
    if (!L || !R) return socket.emit("err", "Need at least 1 player on each team");
    startMatch(room);
  });

  socket.on("toLobby", () => {
    const { room, p } = ctx();
    if (!room || !p || p.cid !== room.hostCid || room.phase !== "over") return;
    room.phase = "lobby"; room.rope = 0; room.winner = null;
    broadcast(room);
  });

  socket.on("typing", () => {
    const { room, p } = ctx();
    if (!room || !p) return;
    const now = Date.now();
    if (now - (p.lastTyping || 0) < 600) return;
    p.lastTyping = now;
    socket.to(room.code).emit("typing", { cid: p.cid, name: p.name, team: p.team });
  });

  socket.on("emote", e => {
    const { room, p } = ctx();
    if (!room || !p) return;
    const now = Date.now();
    if (now - (p.lastEmote || 0) < 400) return;
    p.lastEmote = now;
    const allowed = ["😂", "💀", "🔥", "🤡", "😭", "👀", "💪", "🫡"];
    if (!allowed.includes(e)) return;
    io.to(room.code).emit("emote", { e, team: p.team, name: p.name });
  });

  socket.on("msg", raw => {
    const { room, p } = ctx();
    if (!room || !p) return;
    const text = clean(raw, MAX_LEN);
    if (!text) return;
    const now = Date.now();
    if (room.phase === "playing") {
      if (now - p.lastAt < COOLDOWN_MS || p.inflight >= MAX_INFLIGHT) return socket.emit("cooldown");
      p.lastAt = now;
      handleMove(room, p, text).catch(e => console.error("move error", e));
    } else {
      if (now - p.lastAt < 400) return;
      p.lastAt = now;
      io.to(room.code).emit("chat", { id: `c${++room.msgSeq}`, kind: "chat", cid: p.cid, name: p.name, team: p.team, avatar: p.avatar, text, at: now });
    }
  });

  socket.on("disconnect", () => {
    const s = sockIndex.get(socket.id);
    sockIndex.delete(socket.id);
    if (!s) return;
    const room = rooms.get(s.code);
    const p = room?.players.get(s.cid);
    if (!room || !p || p.sid !== socket.id) return;
    p.online = false;
    broadcast(room);
    setTimeout(() => {
      if (p.online || !rooms.has(room.code)) return;
      if (room.phase === "lobby" || room.phase === "over") {
        room.players.delete(p.cid);
        sys(room, `${p.name} left`);
        if (room.hostCid === p.cid) {
          const next = [...room.players.values()].find(x => x.online);
          if (next) { room.hostCid = next.cid; sys(room, `${next.name} is now host`); }
        }
        if (![...room.players.values()].some(x => x.online)) { clearTimers(room); rooms.delete(room.code); return; }
        broadcast(room);
      }
    }, 15_000);
  });
});

// GC stale rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyOnline = [...room.players.values()].some(p => p.online);
    if (!anyOnline && now - room.createdAt > 10 * 60_000) { clearTimers(room); rooms.delete(code); }
  }
}, 60_000);

server.listen(PORT, () => console.log(`Tug of Words on :${PORT} · Jev ${process.env.TYPESAFE_API_KEY ? "LIVE" : "MOCK (no TYPESAFE_API_KEY)"}`));
