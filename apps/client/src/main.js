import "./styles.css";

import { RESOURCE_LABELS, RESOURCES, WIN_MODES } from "@shorewood/core";

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8080/ws`;

const AVATARS = [
  { id: "badge_1", icon: "🏰", label: "Castle Keep" },
  { id: "badge_2", icon: "🕍", label: "Stone Arch" },
  { id: "badge_3", icon: "🏛️", label: "Hall Column" },
  { id: "badge_4", icon: "🗼", label: "Clock Spire" },
  { id: "badge_5", icon: "⛪", label: "Abbey" },
  { id: "badge_6", icon: "🪟", label: "Rose Window" },
  { id: "badge_7", icon: "🏯", label: "Courtyard" },
  { id: "badge_8", icon: "🧱", label: "Brick Vault" },
  { id: "badge_9", icon: "🏟️", label: "Forum" },
  { id: "badge_10", icon: "🛖", label: "Hearth Hut" },
  { id: "badge_11", icon: "🪵", label: "Timber Frame" },
  { id: "badge_12", icon: "🏚️", label: "Cottage Roof" },
  { id: "badge_13", icon: "🪜", label: "Ladder Loft" },
  { id: "badge_14", icon: "🏘️", label: "Village Row" },
  { id: "badge_15", icon: "🪨", label: "Granite Crest" }
];

const PLAYER_STYLES = [
  { trail: "#ffffff", structure: "#ffffff" },
  { trail: "#2f6fe0", structure: "#2f6fe0" },
  { trail: "#3c9c54", structure: "#3c9c54" },
  { trail: "#d44747", structure: "#d44747" }
];

const TERRAIN_COLORS = {
  whisperwood: "#8fb597",
  clay_pits: "#ce9983",
  shepherds_meadow: "#a6c79f",
  golden_fields: "#d9c8a0",
  ironridge: "#9daab8",
  wild_heath: "#b9ae9d"
};

const RESOURCE_TO_TERRAIN = {
  timber: "whisperwood",
  clay: "clay_pits",
  wool: "shepherds_meadow",
  harvest: "golden_fields",
  iron: "ironridge"
};

const TERRAIN_EMBLEMS = {
  whisperwood: {
    main: "#5f8d68",
    accent: "#7eaa87",
    line: "#3f5f46",
    badgeBg: "#ecf5e9",
    badgeStroke: "#6d8f72"
  },
  clay_pits: {
    main: "#bb6f55",
    accent: "#d08c73",
    line: "#7f4636",
    badgeBg: "#f7ebe5",
    badgeStroke: "#ad6f59"
  },
  shepherds_meadow: {
    main: "#f0f4f7",
    accent: "#d6e4ea",
    line: "#88a1ad",
    badgeBg: "#edf6f3",
    badgeStroke: "#8ba89d"
  },
  golden_fields: {
    main: "#c49f65",
    accent: "#e0c190",
    line: "#8d6d3f",
    badgeBg: "#f8f1e4",
    badgeStroke: "#b19263"
  },
  ironridge: {
    main: "#708496",
    accent: "#9caab7",
    line: "#4d5f6f",
    badgeBg: "#edf1f5",
    badgeStroke: "#8393a2"
  },
  wild_heath: {
    main: "#7f8f7c",
    accent: "#a8b6a5",
    line: "#5a6657",
    badgeBg: "#edf0e8",
    badgeStroke: "#8b9687"
  }
};

const appEl = document.getElementById("app");
const roomParam = new URLSearchParams(window.location.search).get("room");
const embedMode = window.location.pathname.startsWith("/embed");

function loadStoredSession(roomId) {
  if (!roomId) {
    return null;
  }

  const raw = localStorage.getItem(`shorewood_session_${roomId}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.sessionToken === "string") {
      return parsed;
    }
  } catch {
    // Backward compatibility with legacy string-only session storage.
  }

  if (typeof raw === "string" && raw.startsWith("sess_")) {
    return { sessionToken: raw, reconnectSecret: null, playerId: null };
  }

  return null;
}

const storedSession = loadStoredSession(roomParam);

const state = {
  ws: null,
  connected: false,
  roomId: roomParam,
  sessionToken: storedSession?.sessionToken ?? null,
  reconnectSecret: storedSession?.reconnectSecret ?? null,
  playerId: storedSession?.playerId ?? null,
  role: null,
  roomState: null,
  gameState: null,
  promptMessage: null,
  toast: null,
  profile: {
    name: localStorage.getItem("shorewood_name") || "Guest",
    avatarId: localStorage.getItem("shorewood_avatar") || "badge_1"
  },
  joinRoomInput: "",
  fastBuildEnabled: true,
  pendingPlacement: null,
  pendingDevPlay: null,
  optionHandlers: [],
  tradeDraft: {
    toPlayerId: "",
    giveResource: "timber",
    giveAmount: 1,
    receiveResource: "clay",
    receiveAmount: 1
  },
  bankDraft: {
    giveResource: "timber",
    receiveResource: "clay",
    receiveAmount: 1
  }
};

function saveProfile() {
  localStorage.setItem("shorewood_name", state.profile.name);
  localStorage.setItem("shorewood_avatar", state.profile.avatarId);
}

function saveSession() {
  if (state.roomId && state.sessionToken && state.reconnectSecret) {
    localStorage.setItem(
      `shorewood_session_${state.roomId}`,
      JSON.stringify({
        sessionToken: state.sessionToken,
        reconnectSecret: state.reconnectSecret,
        playerId: state.playerId || null
      })
    );
  }
}

function setToast(text, kind = "info") {
  state.toast = { text, kind, ts: Date.now() };
  render();
}

function clearToastAfterDelay() {
  setTimeout(() => {
    if (state.toast && Date.now() - state.toast.ts > 5000) {
      state.toast = null;
      render();
    }
  }, 5200);
}

function send(type, payload = {}) {
  if (!state.connected || !state.ws) {
    setToast("Not connected to server", "error");
    return;
  }
  state.ws.send(JSON.stringify({ type, payload }));
}

function connectSocket() {
  if (state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.ws.readyState)) {
    return;
  }

  const ws = new WebSocket(WS_URL);
  state.ws = ws;

  ws.addEventListener("open", () => {
    state.connected = true;

    if (state.roomId && state.sessionToken && state.reconnectSecret) {
      send("reconnect", {
        roomId: state.roomId,
        sessionToken: state.sessionToken,
        reconnectSecret: state.reconnectSecret
      });
    }

    render();
  });

  ws.addEventListener("close", () => {
    state.connected = false;
    render();
  });

  ws.addEventListener("message", (event) => {
    const packet = JSON.parse(event.data);
    handleServerMessage(packet.type, packet.payload);
  });
}

function handleServerMessage(type, payload) {
  if (type === "playerStatus") {
    if (payload.sessionToken) {
      state.sessionToken = payload.sessionToken;
      state.reconnectSecret = payload.reconnectSecret || state.reconnectSecret;
      state.playerId = payload.playerId || state.playerId;
      state.role = payload.role || state.role;
      if (payload.roomId) {
        state.roomId = payload.roomId;
      }
      saveSession();

      const params = new URLSearchParams(window.location.search);
      if (state.roomId && params.get("room") !== state.roomId) {
        params.set("room", state.roomId);
        const target = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, "", target);
      }
    }
    if (payload.pending) {
      setToast("Join request sent. Waiting for host admission.");
      clearToastAfterDelay();
    }
  }

  if (type === "roomState") {
    state.roomState = payload;
    state.roomId = payload.roomId;
    if (payload.selfPlayerId) {
      state.playerId = payload.selfPlayerId;
    }
    saveSession();
    render();
    return;
  }

  if (type === "gameState") {
    state.gameState = payload;
    state.roomState = null;
    render();
    return;
  }

  if (type === "prompt") {
    state.promptMessage = payload;
    if (payload.kind === "devCardReveal") {
      setToast(`You drew ${formatCardLabel(payload.cardType)}.`, "info");
      clearToastAfterDelay();
    }
    if (payload.kind === "admitted") {
      setToast("Host admitted you to the room.", "success");
      clearToastAfterDelay();
    }
    render();
    return;
  }

  if (type === "error") {
    setToast(payload.reason || "Action failed", "error");
    clearToastAfterDelay();
    return;
  }

  if (type === "tradeOffer") {
    setToast("New trade offer posted.");
    clearToastAfterDelay();
    return;
  }

  if (type === "tradeResolved") {
    setToast(`Trade ${payload.status}.`);
    clearToastAfterDelay();
    return;
  }

  render();
}

function createRoom() {
  if (!state.profile.name.trim()) {
    setToast("Enter a display name before creating a room", "error");
    clearToastAfterDelay();
    return;
  }

  saveProfile();
  send("createRoom", {
    sessionToken: state.sessionToken,
    name: state.profile.name.trim(),
    avatarId: state.profile.avatarId
  });
}

function requestJoinRoom(roomId) {
  if (!roomId) {
    setToast("Enter a room id", "error");
    clearToastAfterDelay();
    return;
  }
  if (!state.profile.name.trim()) {
    setToast("Enter a display name before joining", "error");
    clearToastAfterDelay();
    return;
  }

  saveProfile();
  state.roomId = roomId;
  send("requestJoin", {
    roomId,
    sessionToken: state.sessionToken,
    reconnectSecret: state.reconnectSecret,
    name: state.profile.name.trim(),
    avatarId: state.profile.avatarId
  });
}

function formatWinMode(winMode) {
  if (winMode === WIN_MODES.FIRST_TO_10) {
    return "First to 10 points";
  }
  if (winMode === WIN_MODES.HIGHEST_AT_60) {
    return "Highest points at 60 minutes";
  }
  return "Voting";
}

function formatCardLabel(type) {
  if (!type) {
    return "Unknown card";
  }
  return type
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function avatarIcon(id) {
  return AVATARS.find((avatar) => avatar.id === id)?.icon ?? "🏡";
}

function toResourceText(bag) {
  return Object.entries(bag)
    .filter(([, amount]) => amount > 0)
    .map(([resource, amount]) => `${amount} ${RESOURCE_LABELS[resource]}`)
    .join(", ");
}

function getMeInGame() {
  if (!state.gameState || !state.playerId) {
    return null;
  }
  return state.gameState.players.find((player) => player.id === state.playerId) ?? null;
}

function getPlayerStyle(playerId) {
  const order = state.gameState?.playerOrder ?? [];
  const idx = order.indexOf(playerId);
  return PLAYER_STYLES[idx >= 0 ? idx % PLAYER_STYLES.length : 0];
}

function triggerOption(index) {
  const handler = state.optionHandlers[index];
  if (handler) {
    handler();
  }
}

document.addEventListener("keydown", (event) => {
  if (/^[1-9]$/.test(event.key)) {
    triggerOption(Number(event.key) - 1);
  }
  if (event.key === "Escape") {
    state.pendingPlacement = null;
    state.pendingDevPlay = null;
    render();
  }
});

function renderAvatarPicker() {
  return `
    <div class="section panel">
      <h3>Profile</h3>
      <div class="inline-row" style="margin-top:8px; margin-bottom:8px;">
        <label for="name-input">Display name</label>
        <input id="name-input" value="${escapeHtml(state.profile.name)}" maxlength="20" />
      </div>
      <div class="avatar-grid">
        ${AVATARS.map(
          (avatar) => `
          <button class="avatar-choice ${avatar.id === state.profile.avatarId ? "selected" : ""}" data-avatar="${avatar.id}" title="${avatar.label}">
            <div style="font-size: 20px;">${avatar.icon}</div>
            <div style="font-size: 11px;">${avatar.label}</div>
          </button>
        `
        ).join("")}
      </div>
      <div class="inline-row" style="margin-top:10px;">
        <button id="save-profile">Save Profile</button>
      </div>
    </div>
  `;
}

function renderLanding() {
  const roomFromUrl = roomParam || "";
  appEl.className = embedMode ? "embed" : "";
  appEl.innerHTML = `
    <div class="app-shell">
      <div class="app-header panel">
        <div class="header-title">
          <h1>Shorewood</h1>
          <span class="muted">Cottagecore Multiplayer Settlement Game</span>
        </div>
        <span class="status-pill ${state.connected ? "" : "error"}">${state.connected ? "Connected" : "Disconnected"}</span>
      </div>
      <div class="lobby-wrap panel">
        <div class="section">
          <h2>Create or Join</h2>
          <p class="muted">No account needed. Share a room link and play with 2 to 4 guests.</p>
          <div class="inline-row" style="margin-top:8px;">
            <button id="create-room-btn">Create Room</button>
          </div>
          <div class="inline-row" style="margin-top:8px;">
            <input id="join-room-input" placeholder="room id" value="${escapeHtml(roomFromUrl || state.joinRoomInput)}" />
            <button id="join-room-btn">Request Join</button>
          </div>
        </div>
        ${renderAvatarPicker()}
      </div>
      ${renderToast()}
    </div>
  `;

  bindProfileEvents();
  const createBtn = document.getElementById("create-room-btn");
  createBtn?.addEventListener("click", createRoom);

  const joinBtn = document.getElementById("join-room-btn");
  joinBtn?.addEventListener("click", () => {
    const input = document.getElementById("join-room-input");
    const roomId = (input?.value || "").trim();
    state.joinRoomInput = roomId;
    requestJoinRoom(roomId);
  });
}

function renderLobby() {
  const rs = state.roomState;
  const me = rs.players.find((player) => player.playerId === rs.selfPlayerId) ?? null;
  const canStart = rs.canStart && state.role === "host";

  appEl.className = embedMode ? "embed" : "";
  appEl.innerHTML = `
    <div class="app-shell">
      <div class="app-header panel">
        <div class="header-title">
          <h1>Shorewood Lobby</h1>
          <span class="muted">Room ${escapeHtml(rs.roomId)}</span>
        </div>
        <span class="status-pill">Expires ${new Date(rs.expiresAt).toLocaleString()}</span>
      </div>
      <div class="lobby-wrap panel">
        <div class="section">
          <h2>Players</h2>
          <div class="banner">Share link: <code>${window.location.origin}?room=${rs.roomId}</code></div>
          <div style="margin-top:10px;">
            ${rs.players
              .map(
                (player) => `
                <div class="player-row">
                  <div class="avatar-badge">${avatarIcon(player.avatarId)}</div>
                  <div>
                    <strong>${escapeHtml(player.name)}</strong>
                    ${player.isHost ? '<span class="status-pill">Host</span>' : ""}
                  </div>
                  <div>${player.ready ? "Ready" : "Not Ready"}</div>
                </div>
              `
              )
              .join("")}
          </div>
          <div class="inline-row" style="margin-top:10px;">
            <button id="toggle-ready">${me?.ready ? "Set Not Ready" : "Ready Up"}</button>
            ${canStart ? '<button id="start-match">Start Match</button>' : ""}
          </div>
          ${state.role === "host" ? renderPendingRequests(rs.pendingRequests) : ""}
        </div>
        ${renderAvatarPicker()}
      </div>
      ${state.promptMessage?.kind === "waitingForHostAdmission" ? '<div class="panel section">Waiting for host approval...</div>' : ""}
      ${renderToast()}
    </div>
  `;

  bindProfileEvents(rs.roomId);

  const readyBtn = document.getElementById("toggle-ready");
  readyBtn?.addEventListener("click", () => {
    send("readyUp", { roomId: rs.roomId, ready: !me?.ready });
  });

  const startBtn = document.getElementById("start-match");
  startBtn?.addEventListener("click", () => {
    send("startMatch", { roomId: rs.roomId });
  });

  for (const request of rs.pendingRequests || []) {
    const safePlayerId = CSS.escape(request.playerId);
    const admitBtn = document.querySelector(`[data-admit='${safePlayerId}']`);
    const denyBtn = document.querySelector(`[data-deny='${safePlayerId}']`);

    admitBtn?.addEventListener("click", () => {
      send("hostAdmit", { roomId: rs.roomId, playerId: request.playerId });
    });

    denyBtn?.addEventListener("click", () => {
      send("hostDeny", { roomId: rs.roomId, playerId: request.playerId });
    });
  }
}

function renderPendingRequests(requests) {
  if (!requests || requests.length === 0) {
    return "";
  }

  return `
    <div class="section panel" style="margin-top:10px;">
      <h3>Join Requests</h3>
      ${requests
        .map(
          (req) => `
        <div class="player-row">
          <div class="avatar-badge">${avatarIcon(req.avatarId)}</div>
          <div>${escapeHtml(req.name)}</div>
          <div class="inline-row">
            <button data-admit="${escapeAttr(req.playerId)}">Admit</button>
            <button data-deny="${escapeAttr(req.playerId)}">Deny</button>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function computeBoardBounds(board) {
  const size = board.hexSize;
  const xs = board.hexes.map((hex) => hex.x);
  const ys = board.hexes.map((hex) => hex.y);
  const minX = Math.min(...xs) - size * 2;
  const maxX = Math.max(...xs) + size * 2;
  const minY = Math.min(...ys) - size * 2;
  const maxY = Math.max(...ys) + size * 2;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function hexPoints(hex, size) {
  return hexPointsAt(hex.x, hex.y, size);
}

function hexPointsAt(x, y, size) {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push(`${x + size * Math.cos(angle)},${y + size * Math.sin(angle)}`);
  }
  return points.join(" ");
}

function renderTerrainGlyph(terrainId, emblem) {
  switch (terrainId) {
    case "whisperwood":
      return `
        <rect x="-2.2" y="-0.2" width="4.4" height="9" rx="1" fill="${emblem.line}" />
        <circle cx="0" cy="-5.8" r="5.2" fill="${emblem.main}" />
        <circle cx="-4.6" cy="-4.2" r="3.4" fill="${emblem.accent}" />
        <circle cx="4.4" cy="-4.1" r="3.1" fill="${emblem.accent}" />
      `;
    case "clay_pits":
      return `
        <rect x="-8.5" y="-7.5" width="7.8" height="5.1" rx="1" fill="${emblem.main}" />
        <rect x="0.7" y="-7.5" width="7.8" height="5.1" rx="1" fill="${emblem.main}" />
        <rect x="-3.9" y="-1.7" width="7.8" height="5.1" rx="1" fill="${emblem.accent}" />
        <rect x="-8.5" y="4.1" width="7.8" height="5.1" rx="1" fill="${emblem.accent}" />
        <rect x="0.7" y="4.1" width="7.8" height="5.1" rx="1" fill="${emblem.accent}" />
      `;
    case "shepherds_meadow":
      return `
        <circle cx="-4.8" cy="-1.2" r="4.2" fill="${emblem.main}" />
        <circle cx="0" cy="-4.5" r="5.2" fill="${emblem.main}" />
        <circle cx="5" cy="-1.1" r="4.1" fill="${emblem.main}" />
        <rect x="-8.8" y="-0.8" width="17.6" height="8.5" rx="4.2" fill="${emblem.accent}" />
      `;
    case "golden_fields":
      return `
        <path d="M0 8 L0 -8 M0 -8 L-3.4 -4.8 M0 -4.7 L3.4 -1.8 M0 -1.5 L-3.3 1.4 M0 1.6 L3.3 4.4" fill="none" stroke="${emblem.line}" stroke-width="1.5" stroke-linecap="round" />
        <path d="M-5.4 8 L-5.4 -4.8 M-5.4 -4.8 L-8.1 -2.4 M-5.4 -1.8 L-2.7 0.5" fill="none" stroke="${emblem.main}" stroke-width="1.3" stroke-linecap="round" />
        <path d="M5.4 8 L5.4 -5.1 M5.4 -5.1 L8.1 -2.6 M5.4 -2.2 L2.8 0.4" fill="none" stroke="${emblem.main}" stroke-width="1.3" stroke-linecap="round" />
      `;
    case "ironridge":
      return `
        <polygon points="-8,4 -4,-4 4,-4 8,4 4,8 -4,8" fill="${emblem.main}" />
        <polygon points="-3.2,2 0,-2.7 3.2,2 0,5.5" fill="${emblem.accent}" />
        <path d="M-7.7 4.2 H7.7" stroke="${emblem.line}" stroke-width="1.2" stroke-linecap="round" />
      `;
    case "wild_heath":
      return `
        <path d="M0 8 C1 3 2 -1 6 -5 C2 -4 -2 -2 -4 1 C-5 2 -6 4 -6 7" fill="${emblem.accent}" stroke="${emblem.line}" stroke-width="1.2" />
        <circle cx="5.7" cy="-5.5" r="1.7" fill="${emblem.main}" />
      `;
    default:
      return "";
  }
}

function renderTerrainEmblem(hex) {
  const emblem = TERRAIN_EMBLEMS[hex.terrainId];
  if (!emblem) {
    return "";
  }

  return `
    <g class="hex-emblem" transform="translate(${hex.x} ${hex.y})">
      <g class="hex-emblem-watermark">
        <circle cx="0" cy="3" r="20" fill="${emblem.badgeBg}" />
        <g transform="translate(0 3) scale(1.35)">
          ${renderTerrainGlyph(hex.terrainId, emblem)}
        </g>
      </g>
      <g class="hex-emblem-badge" transform="translate(0 31)">
        <circle cx="0" cy="0" r="12.5" fill="${emblem.badgeBg}" stroke="${emblem.badgeStroke}" stroke-width="1.1" />
        <g transform="scale(0.78)">
          ${renderTerrainGlyph(hex.terrainId, emblem)}
        </g>
      </g>
    </g>
  `;
}

function renderMarketGlyph(stall) {
  if (stall.kind === "specific" && stall.resource) {
    const terrainId = RESOURCE_TO_TERRAIN[stall.resource];
    const emblem = TERRAIN_EMBLEMS[terrainId];
    if (terrainId && emblem) {
      return `
        <circle cx="0" cy="0" r="10.7" fill="${emblem.badgeBg}" stroke="${emblem.badgeStroke}" stroke-width="1.2" />
        <g transform="scale(0.8)">
          ${renderTerrainGlyph(terrainId, emblem)}
        </g>
      `;
    }
  }

  return `
    <circle cx="0" cy="0" r="10.7" fill="#f8efe0" stroke="#8f8268" stroke-width="1.2" />
    <path d="M-5.8 -3.8 L5.8 -3.8 L2.1 -7.4 M-2.1 7.4 L-5.8 3.8 L5.8 3.8" fill="none" stroke="#6f614a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M-6.6 -4.2 L6.6 4.2" stroke="#6f614a" stroke-width="1.2" stroke-linecap="round" />
  `;
}

function renderMarket(node, hexSize) {
  if (!node.stall) {
    return "";
  }

  const size = hexSize / 3;
  const magnitude = Math.hypot(node.x, node.y) || 1;
  const offsetX = (node.x / magnitude) * size * 0.95;
  const offsetY = (node.y / magnitude) * size * 0.95;
  const centerX = node.x + offsetX;
  const centerY = node.y + offsetY;
  const resourceAttr = node.stall.resource ? `data-market-resource="${escapeAttr(node.stall.resource)}"` : "";

  return `
    <g
      class="market"
      data-market-id="${escapeAttr(node.stall.id)}"
      data-market-kind="${escapeAttr(node.stall.kind)}"
      data-market-ratio="${node.stall.ratio}"
      data-market-size="${size.toFixed(2)}"
      ${resourceAttr}
    >
      <polygon class="market-hex outer" points="${hexPointsAt(centerX, centerY, size)}" />
      <polygon class="market-hex inner" points="${hexPointsAt(centerX, centerY, size * 0.74)}" />
      <g class="market-icon" transform="translate(${centerX} ${centerY - 1}) scale(0.52)">
        ${renderMarketGlyph(node.stall)}
      </g>
      <text class="market-ratio" x="${centerX}" y="${centerY + size * 0.79}">${node.stall.ratio}:1</text>
    </g>
  `;
}

function getStructureAt(gameState, intersectionId) {
  return gameState.structures.intersections[intersectionId] ?? null;
}

function renderBoard(gameState) {
  const board = gameState.board;
  const bounds = computeBoardBounds(board);

  const frostByHex = new Map();
  for (const player of gameState.players) {
    for (const frost of player.frostEffects || []) {
      const list = frostByHex.get(frost.hexId) ?? [];
      list.push({ playerName: player.name, remainingTurns: frost.remainingTurns });
      frostByHex.set(frost.hexId, list);
    }
  }

  const highlightTrails = new Set(state.fastBuildEnabled ? gameState.fastBuildTargets?.trails ?? [] : []);
  const highlightCottages = new Set(state.fastBuildEnabled ? gameState.fastBuildTargets?.cottages ?? [] : []);
  const highlightManors = new Set(state.fastBuildEnabled ? gameState.fastBuildTargets?.manors ?? [] : []);

  const charterPlayable = state.pendingDevPlay?.type === "charter_claim";

  return `
    <div class="board-wrap panel section">
      <svg class="board-svg" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}">
        <circle cx="0" cy="0" r="${board.hexSize * 4.2}" fill="#eadfca" />
        ${board.hexes
          .map((hex) => {
            const frost = frostByHex.get(hex.id);
            const charter = gameState.charterClaim?.hexId === hex.id;
            return `
              <g>
                <polygon
                  points="${hexPoints(hex, board.hexSize)}"
                  fill="${TERRAIN_COLORS[hex.terrainId] || "#ccc"}"
                  stroke="#7e7a70"
                  stroke-width="1.6"
                  ${charterPlayable && hex.resource ? `data-charter-hex='${hex.id}' style='cursor:pointer;'` : ""}
                />
                ${renderTerrainEmblem(hex)}
                <text x="${hex.x}" y="${hex.y - 16}" class="hex-label">${hex.terrainName}</text>
                ${hex.token ? `<circle class='token' cx='${hex.x}' cy='${hex.y + 7}' r='18' />` : ""}
                ${hex.token ? `<text class='token-text' x='${hex.x}' y='${hex.y + 13}'>${hex.token}</text>` : ""}
                ${frost ? `<polygon points='${hexPoints(hex, board.hexSize * 0.82)}' fill='rgba(220,233,247,0.45)' stroke='#b5cadf' stroke-width='1.3' />` : ""}
                ${frost ? `<text class='overlay-badge' x='${hex.x}' y='${hex.y - 31}'>Frost: ${frost.map((entry) => `${entry.playerName} (${entry.remainingTurns})`).join(" | ")}</text>` : ""}
                ${charter ? `<polygon points='${hexPoints(hex, board.hexSize * 0.68)}' fill='none' stroke='#8d6e2a' stroke-width='3.5' />` : ""}
                ${charter ? `<text class='overlay-badge' x='${hex.x}' y='${hex.y + 34}'>Charter ${gameState.charterClaim.remainingGlobalTurns}</text>` : ""}
              </g>
            `;
          })
          .join("")}

        ${board.edges
          .map((edge) => {
            const a = board.intersections.find((node) => node.id === edge.a);
            const b = board.intersections.find((node) => node.id === edge.b);
            const owner = gameState.structures.edges[edge.id];
            const isHighlighted = highlightTrails.has(edge.id);
            const color = owner ? getPlayerStyle(owner).trail : "#6a766f";
            return `
              <line
                class="edge ${owner ? "owned" : ""} ${isHighlighted ? "highlight" : ""}"
                x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
                stroke="${color}"
                data-edge-id="${edge.id}"
              />
            `;
          })
          .join("")}

        ${board.intersections
          .map((node) => {
            const structure = getStructureAt(gameState, node.id);
            const isCottageTarget = highlightCottages.has(node.id);
            const isManorTarget = highlightManors.has(node.id);
            const highlight = isCottageTarget || isManorTarget;
            const owner = structure?.ownerId;
            const color = owner ? getPlayerStyle(owner).structure : "#ebe6dc";

            const cottagePath = `M ${node.x - 10} ${node.y + 7} L ${node.x + 10} ${node.y + 7} L ${node.x + 10} ${node.y - 2} L ${node.x} ${node.y - 11} L ${node.x - 10} ${node.y - 2} Z`;
            const manorPath = `M ${node.x - 12} ${node.y + 8} L ${node.x + 12} ${node.y + 8} L ${node.x + 12} ${node.y - 4} L ${node.x + 4} ${node.y - 4} L ${node.x + 4} ${node.y - 14} L ${node.x - 4} ${node.y - 14} L ${node.x - 4} ${node.y - 4} L ${node.x - 12} ${node.y - 4} Z`;

            return `
              <g>
                <circle
                  class="intersection ${highlight ? "highlight" : ""}"
                  cx="${node.x}"
                  cy="${node.y}"
                  r="${highlight ? 7 : 5}"
                  data-intersection-id="${node.id}"
                />
                ${renderMarket(node, board.hexSize)}
                ${structure && structure.type === "cottage" ? `<path class='structure cottage' d='${cottagePath}' fill='${color}' />` : ""}
                ${structure && structure.type === "manor" ? `<path class='structure manor' d='${manorPath}' fill='${color}' />` : ""}
              </g>
            `;
          })
          .join("")}
      </svg>
    </div>
  `;
}

function computeOptions(gameState) {
  const options = [];
  const me = getMeInGame();
  const activePlayerId = gameState.turn?.activePlayerId;
  const iAmActive = activePlayerId === state.playerId;

  if (gameState.phase === "vote") {
    options.push({
      label: "Vote: First to 10 points",
      action: () => send("voteWinCondition", { roomId: state.roomId, mode: WIN_MODES.FIRST_TO_10 })
    });
    options.push({
      label: "Vote: Highest at 60 minutes",
      action: () => send("voteWinCondition", { roomId: state.roomId, mode: WIN_MODES.HIGHEST_AT_60 })
    });
    return options;
  }

  if (gameState.phase === "setup") {
    if (gameState.setup?.currentStep?.playerId === state.playerId) {
      const type = gameState.setup.currentStep.type === "cottage" ? "Cottage" : "Trail";
      options.push({ label: `Place ${type} (click highlighted spot)`, action: () => {} });
    }
    return options;
  }

  if (gameState.phase === "main" && iAmActive) {
    if (!gameState.turn.rolled) {
      options.push({
        label: "Roll 2d6",
        action: () => send("rollDice", { roomId: state.roomId })
      });
    }

    options.push({
      label: state.fastBuildEnabled ? "Disable Fast Build" : "Enable Fast Build",
      action: () => {
        state.fastBuildEnabled = !state.fastBuildEnabled;
        render();
      }
    });

    options.push({
      label: "End Turn",
      action: () => send("endTurn", { roomId: state.roomId })
    });
  }

  if (gameState.pendingHostTieBreak && gameState.hostPlayerId === state.playerId) {
    for (const candidate of gameState.pendingHostTieBreak.candidates) {
      const player = gameState.players.find((entry) => entry.id === candidate);
      options.push({
        label: `Choose ${player?.name ?? candidate} as winner`,
        action: () => send("chooseTimedWinner", { roomId: state.roomId, winnerPlayerId: candidate })
      });
    }
  }

  if (me && gameState.phase === "main") {
    options.push({
      label: "Post Trade Offer",
      action: () => {
        const payload = {
          roomId: state.roomId,
          toPlayerId: state.tradeDraft.toPlayerId || null,
          give: { [state.tradeDraft.giveResource]: Number(state.tradeDraft.giveAmount) },
          receive: { [state.tradeDraft.receiveResource]: Number(state.tradeDraft.receiveAmount) }
        };
        send("proposeTrade", payload);
      }
    });
  }

  return options;
}

function renderOptions(gameState) {
  const options = computeOptions(gameState);
  state.optionHandlers = options.map((option) => option.action);

  return `
    <div class="section panel">
      <h3>Your Options</h3>
      <ol class="options-list">
        ${options
          .map(
            (option, idx) => `
              <li class="option-item">
                <span class="option-num">${idx + 1}</span>
                <span>${option.label}</span>
              </li>
            `
          )
          .join("")}
      </ol>
      ${state.pendingPlacement ? renderPlacementConfirmation() : ""}
      ${state.pendingDevPlay ? renderDevConfirmation() : ""}
    </div>
  `;
}

function renderPlacementConfirmation() {
  return `
    <div class="banner">
      <strong>Confirm ${state.pendingPlacement.type}</strong>
      <div class="inline-row" style="margin-top:6px;">
        <button id="confirm-placement">Confirm</button>
        <button id="cancel-placement">Cancel</button>
      </div>
    </div>
  `;
}

function renderDevConfirmation() {
  if (state.pendingDevPlay.type !== "charter_claim") {
    return "";
  }

  return `
    <div class="banner">
      <strong>Charter Claim</strong>
      <div>Click a producing hex to target Charter Claim.</div>
      <div class="inline-row" style="margin-top:6px;">
        <button id="cancel-dev-play">Cancel</button>
      </div>
    </div>
  `;
}

function renderPlayerList(gameState) {
  const activeId = gameState.turn?.activePlayerId;

  return `
    <div class="section panel">
      <h3>Players</h3>
      ${gameState.players
        .map((player) => {
          const activeClass = player.id === activeId ? "active-turn" : "";
          return `
            <div class="player-row ${activeClass}">
              <div class="avatar-badge">${avatarIcon(player.avatarId)}</div>
              <div>
                <div><strong>${escapeHtml(player.name)}</strong> ${player.id === activeId ? '<span class="status-pill">Turn</span>' : ""}</div>
                <div class="muted">${player.points} pts</div>
              </div>
              <div class="muted">${player.id === state.playerId ? toResourceText(player.resources || {}) || "No cards" : `${player.resourceCount} cards`}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTradePanel(gameState) {
  const me = getMeInGame();
  if (!me || gameState.phase !== "main") {
    return "";
  }

  const otherPlayers = gameState.players.filter((player) => player.id !== state.playerId);
  const pending = (gameState.pendingTrades || []).filter((trade) => trade.status === "pending");

  return `
    <div class="section panel">
      <h3>Trading Desk</h3>
      <div class="grid-2">
        <label>To
          <select id="trade-to-player">
            <option value="">Open offer</option>
            ${otherPlayers
              .map(
                (player) =>
                  `<option value="${escapeAttr(player.id)}" ${state.tradeDraft.toPlayerId === player.id ? "selected" : ""}>${escapeHtml(player.name)}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>Give
          <select id="trade-give-resource">
            ${RESOURCES.map(
              (resource) => `<option value="${resource}" ${state.tradeDraft.giveResource === resource ? "selected" : ""}>${RESOURCE_LABELS[resource]}</option>`
            ).join("")}
          </select>
          <input id="trade-give-amount" type="number" min="1" value="${state.tradeDraft.giveAmount}" />
        </label>
        <label>Receive
          <select id="trade-receive-resource">
            ${RESOURCES.map(
              (resource) => `<option value="${resource}" ${state.tradeDraft.receiveResource === resource ? "selected" : ""}>${RESOURCE_LABELS[resource]}</option>`
            ).join("")}
          </select>
          <input id="trade-receive-amount" type="number" min="1" value="${state.tradeDraft.receiveAmount}" />
        </label>
      </div>
      <div class="inline-row" style="margin-top:8px;">
        <button id="submit-trade">Post Offer</button>
      </div>
      <div style="margin-top:10px;">
        ${pending
          .map((trade) => {
            const from = gameState.players.find((p) => p.id === trade.fromPlayerId);
            const to = trade.toPlayerId ? gameState.players.find((p) => p.id === trade.toPlayerId) : null;
            const targetedAtMe = trade.toPlayerId === state.playerId;
            const openAndNotMine = !trade.toPlayerId && trade.fromPlayerId !== state.playerId;
            const canAccept = targetedAtMe || openAndNotMine;
            const canDecline = canAccept || trade.fromPlayerId === state.playerId;

            return `
              <div class="trade-offer">
                <div><strong>${escapeHtml(from?.name || "Unknown")}</strong> offers ${toResourceText(trade.give)} for ${toResourceText(trade.receive)} ${to ? `to ${escapeHtml(to.name)}` : "(open)"}</div>
                <div class="inline-row" style="margin-top:6px;">
                  ${canAccept ? `<button data-accept-trade="${escapeAttr(trade.id)}">Accept</button>` : ""}
                  ${canDecline ? `<button data-decline-trade="${escapeAttr(trade.id)}">Decline</button>` : ""}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderBazaarPanel(gameState) {
  const me = getMeInGame();
  if (!me || gameState.phase !== "main") {
    return "";
  }

  const ratios = gameState.bankRatios || {};

  return `
    <div class="section panel">
      <h3>Bazaar</h3>
      <div class="muted">Bank ratios from your unlocked stalls:</div>
      <div class="grid-2" style="margin-top:6px;">
        ${RESOURCES.map((resource) => `<div>${RESOURCE_LABELS[resource]}: <strong>${ratios[resource] ?? 4}:1</strong></div>`).join("")}
      </div>
      <div class="grid-2" style="margin-top:8px;">
        <label>Give
          <select id="bank-give">
            ${RESOURCES.map(
              (resource) => `<option value="${resource}" ${state.bankDraft.giveResource === resource ? "selected" : ""}>${RESOURCE_LABELS[resource]}</option>`
            ).join("")}
          </select>
        </label>
        <label>Receive
          <select id="bank-receive">
            ${RESOURCES.map(
              (resource) => `<option value="${resource}" ${state.bankDraft.receiveResource === resource ? "selected" : ""}>${RESOURCE_LABELS[resource]}</option>`
            ).join("")}
          </select>
        </label>
      </div>
      <div class="inline-row" style="margin-top:8px;">
        <button id="do-bank-trade">Trade with Bazaar</button>
      </div>
      <div class="inline-row" style="margin-top:8px;">
        ${RESOURCES.map((giveResource) => {
          const ratio = ratios[giveResource] ?? 4;
          const receive = RESOURCES.find((resource) => resource !== giveResource) || "timber";
          return `<button data-bank-template='${giveResource}:${receive}:${ratio}'>Give ${ratio} ${RESOURCE_LABELS[giveResource]}, Receive 1 ${RESOURCE_LABELS[receive]}</button>`;
        }).join("")}
      </div>
    </div>
  `;
}

function renderDevPanel(gameState) {
  const me = getMeInGame();
  if (!me || gameState.phase !== "main") {
    return "";
  }

  const canPlay = gameState.legalActions.includes("playDevCard");
  const canBuy = gameState.legalActions.includes("buyDevCard");

  return `
    <div class="section panel">
      <h3>Development Cards</h3>
      <div class="inline-row">
        <button id="buy-dev-card" ${canBuy ? "" : "disabled"}>Buy Dev Card</button>
      </div>
      <div style="margin-top:8px;">
        ${(me.devCards || [])
          .map(
            (card) => `
            <div class="trade-offer">
              <div><strong>${formatCardLabel(card.type)}</strong></div>
              <div class="inline-row" style="margin-top:6px;">
                ${card.type !== "heritage_deed" ? `<button data-play-card="${card.id}" ${canPlay ? "" : "disabled"}>Play</button>` : '<span class="status-pill">Passive +1 VP</span>'}
              </div>
            </div>
          `
          )
          .join("") || '<div class="muted">No cards in hand.</div>'}
      </div>
    </div>
  `;
}

function renderLogPanel(gameState) {
  const entries = [...(gameState.log || [])].slice(-80).reverse();
  return `
    <div class="panel section">
      <h3>Event Log</h3>
      <div class="log-wrap">
        ${entries
          .map(
            (entry) => `
            <div class="log-item">
              <span class="muted">${new Date(entry.ts).toLocaleTimeString()}</span>
              <div>${escapeHtml(entry.text)}</div>
            </div>
          `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderGame() {
  const gs = state.gameState;
  const activeId = gs.turn?.activePlayerId;

  appEl.className = embedMode ? "embed" : "";
  appEl.innerHTML = `
    <div class="app-shell">
      <div class="app-header panel">
        <div class="header-title">
          <h1>Shorewood</h1>
          <span class="muted">Win: ${formatWinMode(gs.winMode)}</span>
        </div>
        <div class="inline-row">
          <span class="status-pill">Room ${escapeHtml(gs.roomId)}</span>
          ${gs.turn ? `<span class='status-pill'>Turn ${gs.turn.number}</span>` : ""}
          ${activeId ? `<span class='status-pill'>Active: ${escapeHtml(gs.players.find((p) => p.id === activeId)?.name || "")}</span>` : ""}
        </div>
      </div>

      <div class="layout">
        <aside class="left">
          ${renderPlayerList(gs)}
          ${renderTradePanel(gs)}
        </aside>

        <main class="center">
          ${renderBoard(gs)}
        </main>

        <aside class="right">
          ${renderOptions(gs)}
          ${renderBazaarPanel(gs)}
          ${renderDevPanel(gs)}
        </aside>
      </div>

      ${renderLogPanel(gs)}
      ${renderToast()}
    </div>
  `;

  bindBoardInteractions(gs);
  bindGamePanelInteractions(gs);
}

function bindProfileEvents(roomId = null) {
  for (const avatar of AVATARS) {
    const button = document.querySelector(`[data-avatar='${avatar.id}']`);
    button?.addEventListener("click", () => {
      state.profile.avatarId = avatar.id;
      render();
    });
  }

  const saveButton = document.getElementById("save-profile");
  saveButton?.addEventListener("click", () => {
    const input = document.getElementById("name-input");
    state.profile.name = input.value.trim().slice(0, 20);
    if (!state.profile.name) {
      setToast("Display name cannot be empty", "error");
      clearToastAfterDelay();
      return;
    }

    saveProfile();
    if (roomId) {
      send("setProfile", {
        roomId,
        name: state.profile.name,
        avatarId: state.profile.avatarId
      });
    }

    render();
  });

  const input = document.getElementById("name-input");
  input?.addEventListener("change", () => {
    state.profile.name = input.value;
  });
}

function bindBoardInteractions(gs) {
  const me = getMeInGame();
  if (!me) {
    return;
  }

  const canAct = gs.turn?.activePlayerId === state.playerId || gs.phase === "setup";

  if (canAct) {
    document.querySelectorAll("[data-edge-id]").forEach((element) => {
      element.addEventListener("click", () => {
        const edgeId = element.getAttribute("data-edge-id");
        if (!(gs.fastBuildTargets?.trails || []).includes(edgeId)) {
          return;
        }
        state.pendingPlacement = { type: "trail", edgeId };
        render();
      });
    });

    document.querySelectorAll("[data-intersection-id]").forEach((element) => {
      element.addEventListener("click", () => {
        const intersectionId = element.getAttribute("data-intersection-id");
        const canBuildCottage = (gs.fastBuildTargets?.cottages || []).includes(intersectionId);
        const canUpgrade = (gs.fastBuildTargets?.manors || []).includes(intersectionId);

        if (canBuildCottage) {
          state.pendingPlacement = { type: "cottage", intersectionId };
          render();
        } else if (canUpgrade) {
          state.pendingPlacement = { type: "manor", intersectionId };
          render();
        }
      });
    });
  }

  if (state.pendingDevPlay?.type === "charter_claim") {
    document.querySelectorAll("[data-charter-hex]").forEach((element) => {
      element.addEventListener("click", () => {
        const hexId = element.getAttribute("data-charter-hex");
        send("playDevCard", {
          roomId: state.roomId,
          cardId: state.pendingDevPlay.cardId,
          hexId
        });
        state.pendingDevPlay = null;
      });
    });
  }
}

function bindGamePanelInteractions(_gs) {
  const confirmPlacement = document.getElementById("confirm-placement");
  const cancelPlacement = document.getElementById("cancel-placement");
  const cancelDevPlay = document.getElementById("cancel-dev-play");

  confirmPlacement?.addEventListener("click", () => {
    if (!state.pendingPlacement) {
      return;
    }

    if (state.pendingPlacement.type === "trail") {
      send("buildTrail", { roomId: state.roomId, edgeId: state.pendingPlacement.edgeId });
    }
    if (state.pendingPlacement.type === "cottage") {
      send("buildCottage", { roomId: state.roomId, intersectionId: state.pendingPlacement.intersectionId });
    }
    if (state.pendingPlacement.type === "manor") {
      send("upgradeManor", { roomId: state.roomId, intersectionId: state.pendingPlacement.intersectionId });
    }

    state.pendingPlacement = null;
  });

  cancelPlacement?.addEventListener("click", () => {
    state.pendingPlacement = null;
    render();
  });

  cancelDevPlay?.addEventListener("click", () => {
    state.pendingDevPlay = null;
    render();
  });

  const submitTrade = document.getElementById("submit-trade");
  submitTrade?.addEventListener("click", () => {
    syncTradeDraftFromDom();
    send("proposeTrade", {
      roomId: state.roomId,
      toPlayerId: state.tradeDraft.toPlayerId || null,
      give: { [state.tradeDraft.giveResource]: Number(state.tradeDraft.giveAmount) },
      receive: { [state.tradeDraft.receiveResource]: Number(state.tradeDraft.receiveAmount) }
    });
  });

  document.querySelectorAll("[data-accept-trade]").forEach((button) => {
    button.addEventListener("click", () => {
      send("acceptTrade", { roomId: state.roomId, tradeId: button.getAttribute("data-accept-trade") });
    });
  });

  document.querySelectorAll("[data-decline-trade]").forEach((button) => {
    button.addEventListener("click", () => {
      send("declineTrade", { roomId: state.roomId, tradeId: button.getAttribute("data-decline-trade") });
    });
  });

  const doBankTrade = document.getElementById("do-bank-trade");
  doBankTrade?.addEventListener("click", () => {
    syncBankDraftFromDom();
    send("bankTrade", {
      roomId: state.roomId,
      giveResource: state.bankDraft.giveResource,
      receiveResource: state.bankDraft.receiveResource,
      receiveAmount: Number(state.bankDraft.receiveAmount)
    });
  });

  document.querySelectorAll("[data-bank-template]").forEach((button) => {
    button.addEventListener("click", () => {
      const [giveResource, receiveResource] = button.getAttribute("data-bank-template").split(":");
      state.bankDraft.giveResource = giveResource;
      state.bankDraft.receiveResource = receiveResource;
      state.bankDraft.receiveAmount = 1;
      render();
    });
  });

  const buyDev = document.getElementById("buy-dev-card");
  buyDev?.addEventListener("click", () => {
    send("buyDevCard", { roomId: state.roomId });
  });

  document.querySelectorAll("[data-play-card]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardId = button.getAttribute("data-play-card");
      const me = getMeInGame();
      const card = (me?.devCards || []).find((entry) => entry.id === cardId);
      if (!card) {
        return;
      }

      if (card.type === "trailblazer" || card.type === "hearth_ward") {
        send("playDevCard", { roomId: state.roomId, cardId });
        return;
      }

      if (card.type === "bountiful_basket") {
        const answer = window.prompt("Choose any 2 resources (comma-separated), e.g. timber,iron", "timber,iron");
        if (!answer) {
          return;
        }
        const picks = answer
          .split(",")
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 2);

        send("playDevCard", {
          roomId: state.roomId,
          cardId,
          resources: picks
        });
        return;
      }

      if (card.type === "charter_claim") {
        state.pendingDevPlay = { type: "charter_claim", cardId };
        render();
      }
    });
  });

  document.querySelectorAll(".option-item").forEach((element, idx) => {
    element.addEventListener("click", () => triggerOption(idx));
  });
}

function syncTradeDraftFromDom() {
  state.tradeDraft.toPlayerId = document.getElementById("trade-to-player")?.value || "";
  state.tradeDraft.giveResource = document.getElementById("trade-give-resource")?.value || "timber";
  state.tradeDraft.giveAmount = Number(document.getElementById("trade-give-amount")?.value || 1);
  state.tradeDraft.receiveResource = document.getElementById("trade-receive-resource")?.value || "clay";
  state.tradeDraft.receiveAmount = Number(document.getElementById("trade-receive-amount")?.value || 1);
}

function syncBankDraftFromDom() {
  state.bankDraft.giveResource = document.getElementById("bank-give")?.value || "timber";
  state.bankDraft.receiveResource = document.getElementById("bank-receive")?.value || "clay";
  state.bankDraft.receiveAmount = Number(document.getElementById("bank-receive-amount")?.value || 1);
}

function renderToast() {
  if (!state.toast) {
    return "";
  }
  return `<div class='panel section'><span class='status-pill ${state.toast.kind === "error" ? "error" : ""}'>${escapeHtml(
    state.toast.text
  )}</span></div>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function render() {
  if (!state.connected) {
    appEl.innerHTML = `<div class='app-shell'><div class='panel section'>Connecting to server...</div>${renderToast()}</div>`;
    return;
  }

  if (state.gameState) {
    renderGame();
    return;
  }

  if (state.roomState) {
    renderLobby();
    return;
  }

  renderLanding();
}

window.render_game_to_text = () => {
  const gs = state.gameState;
  const me = getMeInGame();
  const markets = gs?.board?.intersections?.filter((node) => Boolean(node.stall)) || [];
  const marketSummary = {
    total: markets.length,
    ratio_2_to_1: markets.filter((node) => node.stall.ratio === 2).length,
    ratio_3_to_1: markets.filter((node) => node.stall.ratio === 3).length
  };
  const payload = {
    coordinate_system: "SVG viewBox with +x right and +y down",
    mode: gs?.phase || "lobby",
    room_id: state.roomId,
    active_player_id: gs?.turn?.activePlayerId || null,
    turn_number: gs?.turn?.number || 0,
    last_roll: gs?.turn?.lastRoll || null,
    legal_actions: gs?.legalActions || [],
    setup_step: gs?.setup?.currentStep || null,
    pending_placement: state.pendingPlacement,
    market_summary: marketSummary,
    me: me
      ? {
          id: me.id,
          resources: me.resources,
          points: me.points,
          dev_cards: me.devCards?.map((card) => card.type) || []
        }
      : null,
    players: gs?.players?.map((player) => ({
      id: player.id,
      name: player.name,
      points: player.points,
      resource_count: player.resourceCount
    })) || [],
    pending_trade_count: gs?.pendingTrades?.filter((offer) => offer.status === "pending").length || 0,
    log_tail: gs?.log?.slice(-5).map((entry) => entry.text) || []
  };

  return JSON.stringify(payload);
};

window.advanceTime = (_ms) => {
  render();
};

connectSocket();
render();
