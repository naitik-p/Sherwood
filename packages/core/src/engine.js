import {
  BUILD_COSTS,
  DEFAULT_CONFIG,
  DEV_CARD_LABELS,
  RESOURCES,
  VOTE_MODES,
  WIN_MODES
} from "./constants.js";
import { createBoard, getEdge, getHex, getIntersection } from "./board.js";
import {
  bagAddInPlace,
  bagAtLeast,
  bagCount,
  bagSubtractInPlace,
  compactBag,
  ensureResourceBag,
  makeId,
  makeSeededRng,
  nowIso,
  randomInt,
  shuffle
} from "./utils.js";

function createDeck(devCardCounts, rng) {
  const cards = [];
  for (const [type, count] of Object.entries(devCardCounts)) {
    for (let i = 0; i < count; i += 1) {
      cards.push(type);
    }
  }
  return shuffle(cards, rng);
}

function emptyResources() {
  return ensureResourceBag({});
}

function createPlayerState(player, config) {
  return {
    id: player.id,
    name: player.name,
    avatarId: player.avatarId,
    isHost: Boolean(player.isHost),
    resources: emptyResources(),
    trails: [],
    cottages: [],
    manors: [],
    devCards: [],
    playedDevCards: [],
    revealedHeritageCards: 0,
    frostEffects: [],
    protectionTurns: 0,
    pieces: {
      trailsRemaining: config.pieceLimits.trails,
      cottagesRemaining: config.pieceLimits.cottages,
      manorsRemaining: config.pieceLimits.manors
    },
    hasRolledThisTurn: false
  };
}

function newLogEntry(text, ts = Date.now()) {
  return {
    id: makeId("log"),
    text,
    ts,
    iso: nowIso(ts)
  };
}

function pushLog(state, text, ts = Date.now()) {
  state.log.push(newLogEntry(text, ts));
}

function getPlayer(state, playerId) {
  const player = state.players[playerId];
  if (!player) {
    throw new Error("Unknown player");
  }
  return player;
}

function getStructureAtIntersection(state, intersectionId) {
  return state.structures.intersections[intersectionId] ?? null;
}

function getStructureOwnerAtIntersection(state, intersectionId) {
  const structure = getStructureAtIntersection(state, intersectionId);
  return structure ? structure.ownerId : null;
}

function hasNeighborStructure(state, intersectionId) {
  const node = getIntersection(state.board, intersectionId);
  return node.adjacentIntersectionIds.some((neighborId) => Boolean(getStructureAtIntersection(state, neighborId)));
}

function playerOwnsEdgeAdjacentToIntersection(player, intersection) {
  return intersection.edgeIds.some((edgeId) => player.trails.includes(edgeId));
}

function isEdgeConnectedToNetwork(state, player, edge) {
  const aNode = getIntersection(state.board, edge.a);
  const bNode = getIntersection(state.board, edge.b);
  const aOwner = getStructureOwnerAtIntersection(state, aNode.id);
  const bOwner = getStructureOwnerAtIntersection(state, bNode.id);

  if (aOwner === player.id || bOwner === player.id) {
    return true;
  }

  return playerOwnsEdgeAdjacentToIntersection(player, aNode) || playerOwnsEdgeAdjacentToIntersection(player, bNode);
}

function getPlayerPoints(state, player) {
  const structurePoints = player.cottages.length + player.manors.length * 2;
  const hiddenDeeds = player.devCards.filter((card) => card.type === "heritage_deed").length;
  return structurePoints + hiddenDeeds;
}

function getPlayerResourceCount(player) {
  return bagCount(player.resources);
}

function getActivePlayerId(state) {
  if (state.phase !== "main") {
    return null;
  }
  return state.turn.order[state.turn.index];
}

function ensureMainActionTurn(state, playerId) {
  if (state.phase !== "main") {
    throw new Error("Match is not in main phase");
  }
  if (getActivePlayerId(state) !== playerId) {
    throw new Error("It is not your turn");
  }
}

function consumeCost(player, cost) {
  if (!bagAtLeast(player.resources, cost)) {
    throw new Error("Insufficient resources");
  }
  bagSubtractInPlace(player.resources, cost);
}

function unlockableStallsForPlayer(state, playerId) {
  const unlocked = [];
  const player = getPlayer(state, playerId);
  const occupiedNodes = new Set([...player.cottages, ...player.manors]);
  for (const nodeId of occupiedNodes) {
    const node = getIntersection(state.board, nodeId);
    if (node?.stall) {
      unlocked.push(node.stall);
    }
  }
  return unlocked;
}

function getBestBankRatio(state, playerId, giveResource) {
  let ratio = 4;
  for (const stall of unlockableStallsForPlayer(state, playerId)) {
    if (stall.kind === "generic") {
      ratio = Math.min(ratio, 3);
    } else if (stall.kind === "specific" && stall.resource === giveResource) {
      ratio = Math.min(ratio, 2);
    }
  }
  return ratio;
}

function produceFromRoll(state, roll) {
  const gains = {};

  for (const hex of state.board.hexes) {
    if (!hex.token || hex.token !== roll || !hex.resource) {
      continue;
    }

    for (const intersectionId of hex.intersectionIds) {
      const structure = getStructureAtIntersection(state, intersectionId);
      if (!structure) {
        continue;
      }

      const owner = getPlayer(state, structure.ownerId);

      if (state.charterClaim && state.charterClaim.hexId === hex.id && state.charterClaim.ownerId !== owner.id) {
        continue;
      }

      const frosted = owner.frostEffects.some((effect) => effect.hexId === hex.id && effect.remainingTurns > 0);
      if (frosted) {
        continue;
      }

      const amount = structure.type === "manor" ? 2 : 1;
      owner.resources[hex.resource] += amount;

      if (!gains[owner.id]) {
        gains[owner.id] = emptyResources();
      }
      gains[owner.id][hex.resource] += amount;
    }
  }

  return gains;
}

function pickFrostHex(state, player, rng) {
  const occupied = new Set();
  const ownedIntersections = [...player.cottages, ...player.manors];

  for (const intersectionId of ownedIntersections) {
    const node = getIntersection(state.board, intersectionId);
    for (const hexId of node.hexIds) {
      const hex = getHex(state.board, hexId);
      if (hex.resource) {
        occupied.add(hex.id);
      }
    }
  }

  if (occupied.size === 0) {
    return null;
  }

  const options = [...occupied];
  const idx = randomInt(options.length, rng);
  return getHex(state.board, options[idx]);
}

function queueForSnakeSetup(playerOrder) {
  const queue = [];
  for (const playerId of playerOrder) {
    queue.push({ playerId, type: "cottage", round: 1 });
    queue.push({ playerId, type: "trail", round: 1 });
  }

  const reverse = [...playerOrder].reverse();
  for (const playerId of reverse) {
    queue.push({ playerId, type: "cottage", round: 2 });
    queue.push({ playerId, type: "trail", round: 2 });
  }

  return queue;
}

function maybeEndFirstToTen(state, ts = Date.now()) {
  if (state.winMode !== WIN_MODES.FIRST_TO_10 || state.phase !== "main") {
    return false;
  }

  const standings = getStandings(state);
  const winner = standings.find((entry) => entry.points >= 10);
  if (!winner) {
    return false;
  }

  state.phase = "ended";
  state.endedAt = ts;
  state.winner = {
    playerId: winner.playerId,
    reason: "Reached 10 points"
  };
  pushLog(state, `${winner.name} reached 10 points and wins the match.`, ts);
  return true;
}

function resolveTimedWinner(state, ts = Date.now()) {
  const standings = getStandings(state);
  const highestPoints = standings[0]?.points ?? 0;
  let tied = standings.filter((entry) => entry.points === highestPoints);

  if (tied.length > 1) {
    const topManors = Math.max(...tied.map((entry) => entry.manors));
    tied = tied.filter((entry) => entry.manors === topManors);
  }

  if (tied.length > 1) {
    const topDevCards = Math.max(...tied.map((entry) => entry.devCardsRemaining));
    tied = tied.filter((entry) => entry.devCardsRemaining === topDevCards);
  }

  if (tied.length === 1) {
    state.phase = "ended";
    state.endedAt = ts;
    state.winner = {
      playerId: tied[0].playerId,
      reason: "Highest points at 60 minutes"
    };
    pushLog(state, `${tied[0].name} wins on the 60-minute score check.`, ts);
    return;
  }

  state.pendingHostTieBreak = {
    candidates: tied.map((entry) => entry.playerId),
    reason: "Timed win tie"
  };
  pushLog(state, "Timed match ended in a tie after tie-breakers. Host must choose the winner.", ts);
}

function tickEndOfTurnEffects(state, player) {
  player.frostEffects = player.frostEffects
    .map((effect) => ({ ...effect, remainingTurns: effect.remainingTurns - 1 }))
    .filter((effect) => effect.remainingTurns > 0);

  if (player.protectionTurns > 0) {
    player.protectionTurns -= 1;
  }

  if (state.charterClaim) {
    state.charterClaim.remainingGlobalTurns -= 1;
    if (state.charterClaim.remainingGlobalTurns <= 0) {
      pushLog(state, "Charter Claim expired.");
      state.charterClaim = null;
    }
  }
}

function startMainPhase(state, ts = Date.now()) {
  state.phase = "main";
  state.matchStartedAt = ts;
  state.turn = {
    order: [...state.playerOrder],
    index: 0,
    number: 1,
    rolled: false,
    lastRoll: null,
    freeTrailBuilds: 0
  };
  pushLog(state, "Setup complete. Main play begins.", ts);
}

function advanceSetupPointer(state, ts = Date.now()) {
  state.setup.index += 1;
  if (state.setup.index >= state.setup.queue.length) {
    startMainPhase(state, ts);
  }
}

function validateTradeBag(bag, label) {
  const normalized = ensureResourceBag(bag);
  const compact = compactBag(normalized);
  const total = Object.values(compact).reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) {
    throw new Error(`${label} must include at least one resource`);
  }
  return compact;
}

function legalTrailTargets(state, playerId) {
  const player = getPlayer(state, playerId);

  return state.board.edges
    .filter((edge) => {
      if (state.structures.edges[edge.id]) {
        return false;
      }

      if (state.phase === "setup") {
        const step = state.setup.queue[state.setup.index];
        if (!step || step.playerId !== playerId || step.type !== "trail") {
          return false;
        }
        return edge.a === state.setup.mustTrailFrom || edge.b === state.setup.mustTrailFrom;
      }

      return isEdgeConnectedToNetwork(state, player, edge);
    })
    .map((edge) => edge.id);
}

function legalCottageTargets(state, playerId) {
  const player = getPlayer(state, playerId);

  return state.board.intersections
    .filter((node) => {
      if (getStructureAtIntersection(state, node.id)) {
        return false;
      }
      if (hasNeighborStructure(state, node.id)) {
        return false;
      }

      if (state.phase === "setup") {
        const step = state.setup.queue[state.setup.index];
        return Boolean(step && step.playerId === playerId && step.type === "cottage");
      }

      return playerOwnsEdgeAdjacentToIntersection(player, node);
    })
    .map((node) => node.id);
}

function legalManorTargets(state, playerId) {
  const player = getPlayer(state, playerId);
  return player.cottages.filter((intersectionId) => {
    const structure = getStructureAtIntersection(state, intersectionId);
    return structure && structure.ownerId === playerId && structure.type === "cottage";
  });
}

function currentSetupStep(state) {
  if (state.phase !== "setup") {
    return null;
  }
  return state.setup.queue[state.setup.index] ?? null;
}

function grantSetupPlacementResources(state, player, intersectionId, ts = Date.now()) {
  const node = getIntersection(state.board, intersectionId);
  const gains = emptyResources();

  for (const hexId of node.hexIds) {
    const hex = getHex(state.board, hexId);
    if (!hex.resource) {
      continue;
    }
    gains[hex.resource] += 1;
    player.resources[hex.resource] += 1;
  }

  const summary = compactBag(gains);
  if (Object.keys(summary).length > 0) {
    const parts = Object.entries(summary).map(([resource, amount]) => `${amount} ${resource}`);
    pushLog(state, `${player.name} receives starting resources from setup placement: ${parts.join(", ")}.`, ts);
  }
}

export function createGameState({ roomId, players, hostPlayerId, config = {}, seed = null, now = Date.now() }) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
    throw new Error("Match requires 2 to 4 players");
  }

  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    buildCosts: { ...BUILD_COSTS, ...(config.buildCosts ?? {}) },
    pieceLimits: { ...DEFAULT_CONFIG.pieceLimits, ...(config.pieceLimits ?? {}) },
    devCardCounts: { ...DEFAULT_CONFIG.devCardCounts, ...(config.devCardCounts ?? {}) }
  };

  const rng = makeSeededRng(seed ?? `${roomId}_${now}`);
  const board = createBoard({ rng });

  const playerOrder = players.map((player) => player.id);
  const statePlayers = {};
  for (const player of players) {
    statePlayers[player.id] = createPlayerState(player, mergedConfig);
  }

  const state = {
    roomId,
    seed: seed ?? `${roomId}_${now}`,
    config: mergedConfig,
    createdAt: now,
    hostPlayerId,
    board,
    players: statePlayers,
    playerOrder,
    phase: "vote",
    vote: {
      deadline: now + mergedConfig.voteDurationMs,
      votes: {},
      resolved: false
    },
    winMode: null,
    setup: null,
    turn: null,
    structures: {
      intersections: {},
      edges: {}
    },
    pendingTrades: [],
    charterClaim: null,
    log: [newLogEntry("Match created. Vote for win condition.", now)],
    matchStartedAt: null,
    endedAt: null,
    winner: null,
    pendingHostTieBreak: null,
    rngStateCalls: 0
  };

  return state;
}

export function castWinVote(state, playerId, mode, ts = Date.now()) {
  if (state.phase !== "vote") {
    throw new Error("Vote phase has ended");
  }
  if (!VOTE_MODES.includes(mode)) {
    throw new Error("Invalid win mode vote");
  }

  getPlayer(state, playerId);
  state.vote.votes[playerId] = mode;
  pushLog(state, `${state.players[playerId].name} voted for ${mode === WIN_MODES.FIRST_TO_10 ? "First to 10" : "Highest at 60 minutes"}.`, ts);

  maybeResolveVote(state, ts);
}

export function maybeResolveVote(state, ts = Date.now()) {
  if (state.phase !== "vote" || state.vote.resolved) {
    return false;
  }

  const votes = Object.values(state.vote.votes);
  const allVoted = votes.length === state.playerOrder.length;
  const timerExpired = ts >= state.vote.deadline;

  if (!allVoted && !timerExpired) {
    return false;
  }

  let selected = WIN_MODES.FIRST_TO_10;

  if (timerExpired && !allVoted) {
    selected = WIN_MODES.FIRST_TO_10;
  } else {
    const firstTo10Votes = votes.filter((vote) => vote === WIN_MODES.FIRST_TO_10).length;
    const timedVotes = votes.filter((vote) => vote === WIN_MODES.HIGHEST_AT_60).length;

    if (firstTo10Votes > timedVotes) {
      selected = WIN_MODES.FIRST_TO_10;
    } else if (timedVotes > firstTo10Votes) {
      selected = WIN_MODES.HIGHEST_AT_60;
    } else {
      selected = state.vote.votes[state.hostPlayerId] ?? WIN_MODES.FIRST_TO_10;
    }
  }

  state.vote.resolved = true;
  state.winMode = selected;
  state.phase = "setup";
  state.setup = {
    queue: queueForSnakeSetup(state.playerOrder),
    index: 0,
    mustTrailFrom: null
  };

  pushLog(
    state,
    `Win condition set to: ${selected === WIN_MODES.FIRST_TO_10 ? "First to 10 points" : "Highest points at 60 minutes"}.`,
    ts
  );
  pushLog(state, "Snake setup begins.", ts);
  return true;
}

export function chooseTimedWinner(state, hostPlayerId, winnerPlayerId, ts = Date.now()) {
  if (!state.pendingHostTieBreak) {
    throw new Error("No host tie-break is pending");
  }
  if (hostPlayerId !== state.hostPlayerId) {
    throw new Error("Only host can choose tie-break winner");
  }
  if (!state.pendingHostTieBreak.candidates.includes(winnerPlayerId)) {
    throw new Error("Chosen player is not in tie-break candidate list");
  }

  const winner = getPlayer(state, winnerPlayerId);
  state.pendingHostTieBreak = null;
  state.phase = "ended";
  state.endedAt = ts;
  state.winner = {
    playerId: winner.id,
    reason: "Host tie-break decision"
  };
  pushLog(state, `${winner.name} was selected by host as tie-break winner.`, ts);
}

export function rollDice(state, playerId, ts = Date.now(), rng = Math.random) {
  ensureMainActionTurn(state, playerId);
  const player = getPlayer(state, playerId);

  if (state.turn.rolled) {
    throw new Error("Dice already rolled this turn");
  }

  const dieA = Math.floor(rng() * 6) + 1;
  const dieB = Math.floor(rng() * 6) + 1;
  const roll = dieA + dieB;

  state.turn.rolled = true;
  state.turn.lastRoll = roll;
  player.hasRolledThisTurn = true;
  pushLog(state, `${player.name} rolled ${roll}.`, ts);

  if (roll === 2) {
    if (player.protectionTurns > 0) {
      pushLog(state, `${player.name} is protected by Hearth Ward. No frost is applied.`, ts);
    } else {
      const frostHex = pickFrostHex(state, player, rng);
      if (frostHex) {
        const existing = player.frostEffects.find((effect) => effect.hexId === frostHex.id);
        if (existing) {
          existing.remainingTurns = 2;
        } else {
          player.frostEffects.push({ hexId: frostHex.id, remainingTurns: 2 });
        }
        pushLog(
          state,
          `${player.name} rolled 2. Frost settles on ${frostHex.terrainName} (token ${frostHex.token}) for ${player.name} for 2 turns.`,
          ts
        );
      } else {
        pushLog(state, `${player.name} rolled 2 but occupies no producing hexes.`, ts);
      }
    }
    return { roll, gains: {} };
  }

  const gains = produceFromRoll(state, roll);
  const summaries = Object.entries(gains).map(([targetPlayerId, bag]) => {
    const target = getPlayer(state, targetPlayerId);
    const detail = Object.entries(compactBag(bag))
      .map(([resource, amount]) => `${amount} ${resource}`)
      .join(", ");
    return `${target.name} gains ${detail}`;
  });

  if (summaries.length > 0) {
    pushLog(state, summaries.join("; "), ts);
  }

  maybeEndFirstToTen(state, ts);
  return { roll, gains };
}

export function buildCottage(state, playerId, intersectionId, ts = Date.now()) {
  const player = getPlayer(state, playerId);

  if (state.phase === "main") {
    ensureMainActionTurn(state, playerId);
    if (!state.turn.rolled) {
      throw new Error("Roll dice before building");
    }
  } else if (state.phase !== "setup") {
    throw new Error("Cannot build cottage right now");
  }

  if (player.pieces.cottagesRemaining <= 0) {
    throw new Error("No cottages remaining");
  }

  const legalTargets = legalCottageTargets(state, playerId);
  if (!legalTargets.includes(intersectionId)) {
    throw new Error("Illegal cottage placement");
  }

  if (state.phase === "main") {
    consumeCost(player, state.config.buildCosts.cottage);
  } else {
    const step = currentSetupStep(state);
    if (!step || step.playerId !== playerId || step.type !== "cottage") {
      throw new Error("Not your setup cottage placement");
    }
  }

  state.structures.intersections[intersectionId] = {
    ownerId: playerId,
    type: "cottage"
  };
  player.cottages.push(intersectionId);
  player.pieces.cottagesRemaining -= 1;

  pushLog(state, `${player.name} placed a Cottage.`, ts);

  if (state.phase === "setup") {
    state.setup.mustTrailFrom = intersectionId;
    const step = currentSetupStep(state);
    if (step.round === 2) {
      grantSetupPlacementResources(state, player, intersectionId, ts);
    }
    advanceSetupPointer(state, ts);
  }

  maybeEndFirstToTen(state, ts);
}

export function buildTrail(state, playerId, edgeId, ts = Date.now()) {
  const player = getPlayer(state, playerId);

  if (state.phase === "main") {
    ensureMainActionTurn(state, playerId);
    if (!state.turn.rolled) {
      throw new Error("Roll dice before building");
    }
  } else if (state.phase !== "setup") {
    throw new Error("Cannot build trail right now");
  }

  if (player.pieces.trailsRemaining <= 0) {
    throw new Error("No trails remaining");
  }

  const legalTargets = legalTrailTargets(state, playerId);
  if (!legalTargets.includes(edgeId)) {
    throw new Error("Illegal trail placement");
  }

  if (state.phase === "main") {
    if (state.turn.freeTrailBuilds > 0) {
      state.turn.freeTrailBuilds -= 1;
    } else {
      consumeCost(player, state.config.buildCosts.trail);
    }
  } else {
    const step = currentSetupStep(state);
    if (!step || step.playerId !== playerId || step.type !== "trail") {
      throw new Error("Not your setup trail placement");
    }
    const edge = getEdge(state.board, edgeId);
    if (edge.a !== state.setup.mustTrailFrom && edge.b !== state.setup.mustTrailFrom) {
      throw new Error("Setup trail must connect to just-placed cottage");
    }
    state.setup.mustTrailFrom = null;
  }

  state.structures.edges[edgeId] = playerId;
  player.trails.push(edgeId);
  player.pieces.trailsRemaining -= 1;

  pushLog(state, `${player.name} placed a Trail.`, ts);

  if (state.phase === "setup") {
    advanceSetupPointer(state, ts);
  }
}

export function upgradeManor(state, playerId, intersectionId, ts = Date.now()) {
  ensureMainActionTurn(state, playerId);
  if (!state.turn.rolled) {
    throw new Error("Roll dice before building");
  }

  const player = getPlayer(state, playerId);
  if (player.pieces.manorsRemaining <= 0) {
    throw new Error("No manors remaining");
  }

  if (!legalManorTargets(state, playerId).includes(intersectionId)) {
    throw new Error("Illegal manor upgrade target");
  }

  consumeCost(player, state.config.buildCosts.manor);

  state.structures.intersections[intersectionId] = {
    ownerId: playerId,
    type: "manor"
  };

  player.cottages = player.cottages.filter((id) => id !== intersectionId);
  player.manors.push(intersectionId);
  player.pieces.cottagesRemaining += 1;
  player.pieces.manorsRemaining -= 1;

  pushLog(state, `${player.name} upgraded a Cottage to a Manor.`, ts);
  maybeEndFirstToTen(state, ts);
}

export function buyDevCard(state, playerId, ts = Date.now()) {
  ensureMainActionTurn(state, playerId);
  if (!state.turn.rolled) {
    throw new Error("Roll dice before buying development cards");
  }

  if (state.devDeck?.length === 0) {
    throw new Error("Development deck is empty");
  }

  const player = getPlayer(state, playerId);
  consumeCost(player, state.config.buildCosts.dev_card);

  const type = state.devDeck.pop();
  const card = {
    id: makeId("dev"),
    type,
    acquiredOnTurn: state.turn.number,
    revealed: false
  };
  player.devCards.push(card);

  pushLog(state, `${player.name} bought a development card.`, ts);
  maybeEndFirstToTen(state, ts);
  return card;
}

export function playDevCard(state, playerId, payload, ts = Date.now()) {
  ensureMainActionTurn(state, playerId);
  if (!state.turn.rolled) {
    throw new Error("Roll dice before playing development cards");
  }

  const player = getPlayer(state, playerId);
  const byId = payload.cardId
    ? player.devCards.find((card) => card.id === payload.cardId)
    : player.devCards.find((card) => card.type === payload.cardType);

  if (!byId) {
    throw new Error("Development card not found");
  }
  if (byId.type === "heritage_deed") {
    throw new Error("Heritage Deed is a passive point card and cannot be played");
  }
  if (byId.acquiredOnTurn === state.turn.number) {
    throw new Error("Cannot play a development card on the same turn it was bought");
  }

  if (byId.type === "trailblazer") {
    state.turn.freeTrailBuilds += 2;
    pushLog(state, `${player.name} played ${DEV_CARD_LABELS[byId.type]} and may place up to 2 free Trails this turn.`, ts);
  } else if (byId.type === "bountiful_basket") {
    const picks = Array.isArray(payload.resources) ? payload.resources : [];
    if (picks.length !== 2 || !picks.every((resource) => RESOURCES.includes(resource))) {
      throw new Error("Bountiful Basket requires exactly 2 chosen resources");
    }
    for (const resource of picks) {
      player.resources[resource] += 1;
    }
    pushLog(state, `${player.name} played ${DEV_CARD_LABELS[byId.type]} and gained 2 resources.`, ts);
  } else if (byId.type === "hearth_ward") {
    player.protectionTurns += 2;
    pushLog(state, `${player.name} played ${DEV_CARD_LABELS[byId.type]} and is protected from Frost for 2 turns.`, ts);
  } else if (byId.type === "charter_claim") {
    const hex = getHex(state.board, payload.hexId);
    if (!hex || !hex.resource) {
      throw new Error("Charter Claim must target a producing hex");
    }
    state.charterClaim = {
      hexId: hex.id,
      ownerId: player.id,
      remainingGlobalTurns: 5
    };
    pushLog(
      state,
      `${player.name} played ${DEV_CARD_LABELS[byId.type]} on ${hex.terrainName}. Only ${player.name} may receive production there for 5 turns.`,
      ts
    );
  }

  player.devCards = player.devCards.filter((card) => card.id !== byId.id);
  player.playedDevCards.push({ ...byId, playedAtTurn: state.turn.number });
  maybeEndFirstToTen(state, ts);
}

export function proposeTrade(state, playerId, payload, ts = Date.now()) {
  ensureMainActionTurn(state, playerId);
  if (!state.turn.rolled) {
    throw new Error("Roll dice before posting a trade offer");
  }

  const fromPlayer = getPlayer(state, playerId);
  const give = validateTradeBag(payload.give, "Trade give");
  const receive = validateTradeBag(payload.receive, "Trade receive");

  if (!bagAtLeast(fromPlayer.resources, give)) {
    throw new Error("You do not currently have the offered resources");
  }

  if (payload.toPlayerId && !state.players[payload.toPlayerId]) {
    throw new Error("Target player does not exist");
  }

  const offer = {
    id: makeId("trade"),
    fromPlayerId: playerId,
    toPlayerId: payload.toPlayerId ?? null,
    give,
    receive,
    createdAt: ts,
    status: "pending"
  };
  state.pendingTrades.push(offer);

  pushLog(state, `${fromPlayer.name} proposed a trade offer.`, ts);
  return offer;
}

export function declineTrade(state, playerId, tradeId, ts = Date.now()) {
  const offer = state.pendingTrades.find((trade) => trade.id === tradeId && trade.status === "pending");
  if (!offer) {
    throw new Error("Trade offer is not pending");
  }

  if (offer.toPlayerId && offer.toPlayerId !== playerId && offer.fromPlayerId !== playerId) {
    throw new Error("You cannot decline this trade");
  }

  offer.status = "declined";
  offer.resolvedBy = playerId;
  offer.resolvedAt = ts;

  pushLog(state, `${state.players[playerId].name} declined a trade offer.`, ts);
  return offer;
}

export function acceptTrade(state, playerId, tradeId, ts = Date.now()) {
  const offer = state.pendingTrades.find((trade) => trade.id === tradeId && trade.status === "pending");
  if (!offer) {
    throw new Error("Trade offer is not pending");
  }

  if (offer.toPlayerId && offer.toPlayerId !== playerId) {
    throw new Error("This trade is targeted to another player");
  }
  if (offer.fromPlayerId === playerId) {
    throw new Error("Offer creator cannot accept their own trade");
  }

  const fromPlayer = getPlayer(state, offer.fromPlayerId);
  const toPlayer = getPlayer(state, playerId);

  if (!bagAtLeast(fromPlayer.resources, offer.give)) {
    throw new Error("Offer creator no longer has required resources");
  }
  if (!bagAtLeast(toPlayer.resources, offer.receive)) {
    throw new Error("Acceptor lacks resources requested by the offer");
  }

  bagSubtractInPlace(fromPlayer.resources, offer.give);
  bagAddInPlace(toPlayer.resources, offer.give);

  bagSubtractInPlace(toPlayer.resources, offer.receive);
  bagAddInPlace(fromPlayer.resources, offer.receive);

  offer.status = "accepted";
  offer.resolvedBy = playerId;
  offer.resolvedAt = ts;

  pushLog(state, `${toPlayer.name} accepted a trade with ${fromPlayer.name}.`, ts);
  return offer;
}

export function bankTrade(state, playerId, payload, ts = Date.now()) {
  ensureMainActionTurn(state, playerId);
  if (!state.turn.rolled) {
    throw new Error("Roll dice before bank trading");
  }

  const { giveResource, receiveResource } = payload;
  if (!RESOURCES.includes(giveResource) || !RESOURCES.includes(receiveResource) || giveResource === receiveResource) {
    throw new Error("Invalid bank trade resources");
  }

  const receiveAmount = Number.isFinite(payload.receiveAmount) ? payload.receiveAmount : 1;
  if (receiveAmount <= 0) {
    throw new Error("Invalid receive amount");
  }

  const ratio = getBestBankRatio(state, playerId, giveResource);
  const requiredGiveAmount = ratio * receiveAmount;
  const giveAmount = payload.giveAmount ?? requiredGiveAmount;

  if (giveAmount !== requiredGiveAmount) {
    throw new Error(`Invalid bank ratio. Required ${requiredGiveAmount}:${receiveAmount}`);
  }

  const player = getPlayer(state, playerId);
  if (player.resources[giveResource] < giveAmount) {
    throw new Error("Insufficient resources for bank trade");
  }

  player.resources[giveResource] -= giveAmount;
  player.resources[receiveResource] += receiveAmount;

  pushLog(
    state,
    `${player.name} traded ${giveAmount} ${giveResource} with the Bazaar for ${receiveAmount} ${receiveResource} (ratio ${ratio}:1).`,
    ts
  );
}

export function endTurn(state, playerId, ts = Date.now()) {
  ensureMainActionTurn(state, playerId);
  if (!state.turn.rolled) {
    throw new Error("You must roll before ending your turn");
  }

  const player = getPlayer(state, playerId);
  tickEndOfTurnEffects(state, player);

  if (state.winMode === WIN_MODES.HIGHEST_AT_60 && state.matchStartedAt) {
    const elapsed = ts - state.matchStartedAt;
    if (elapsed >= state.config.timedWinMinutes * 60_000) {
      resolveTimedWinner(state, ts);
      if (state.phase === "ended") {
        return;
      }
    }
  }

  state.turn.index = (state.turn.index + 1) % state.turn.order.length;
  state.turn.number += 1;
  state.turn.rolled = false;
  state.turn.lastRoll = null;
  state.turn.freeTrailBuilds = 0;

  player.hasRolledThisTurn = false;
  pushLog(state, `${player.name} ended their turn.`, ts);
}

export function checkTimedWin(state, ts = Date.now()) {
  if (state.phase !== "main" || state.winMode !== WIN_MODES.HIGHEST_AT_60 || !state.matchStartedAt) {
    return false;
  }

  const elapsed = ts - state.matchStartedAt;
  if (elapsed < state.config.timedWinMinutes * 60_000) {
    return false;
  }

  resolveTimedWinner(state, ts);
  return true;
}

export function initializeDeck(state) {
  if (state.devDeck) {
    return;
  }
  state.devDeck = createDeck(state.config.devCardCounts, makeSeededRng(`${state.seed}_dev`));
}

export function getStandings(state) {
  const standings = state.playerOrder.map((playerId) => {
    const player = state.players[playerId];
    return {
      playerId,
      name: player.name,
      points: getPlayerPoints(state, player),
      manors: player.manors.length,
      devCardsRemaining: player.devCards.length,
      resourceCount: getPlayerResourceCount(player)
    };
  });

  standings.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    if (b.manors !== a.manors) {
      return b.manors - a.manors;
    }
    return b.devCardsRemaining - a.devCardsRemaining;
  });

  return standings;
}

export function getPlayerBankRatios(state, playerId) {
  const ratios = {};
  for (const resource of RESOURCES) {
    ratios[resource] = getBestBankRatio(state, playerId, resource);
  }
  return ratios;
}

export function getLegalActions(state, playerId) {
  getPlayer(state, playerId);

  if (state.phase === "ended") {
    return [];
  }

  if (state.phase === "vote") {
    return ["voteWinCondition"];
  }

  if (state.phase === "setup") {
    const step = currentSetupStep(state);
    if (!step || step.playerId !== playerId) {
      return [];
    }
    return [step.type === "cottage" ? "buildCottage" : "buildTrail"];
  }

  const activeId = getActivePlayerId(state);
  if (activeId !== playerId) {
    return ["acceptTrade", "declineTrade"];
  }

  if (!state.turn.rolled) {
    return ["rollDice", "acceptTrade", "declineTrade"];
  }

  return [
    "buildTrail",
    "buildCottage",
    "upgradeManor",
    "bankTrade",
    "buyDevCard",
    "playDevCard",
    "proposeTrade",
    "acceptTrade",
    "declineTrade",
    "endTurn"
  ];
}

export function getFastBuildTargets(state, playerId) {
  const player = getPlayer(state, playerId);

  if (state.phase === "setup") {
    const step = currentSetupStep(state);
    if (!step || step.playerId !== playerId) {
      return { trails: [], cottages: [], manors: [] };
    }
    return {
      trails: step.type === "trail" && player.pieces.trailsRemaining > 0 ? legalTrailTargets(state, playerId) : [],
      cottages: step.type === "cottage" && player.pieces.cottagesRemaining > 0 ? legalCottageTargets(state, playerId) : [],
      manors: []
    };
  }

  if (state.phase !== "main" || getActivePlayerId(state) !== playerId || !state.turn?.rolled) {
    return { trails: [], cottages: [], manors: [] };
  }

  return {
    trails: player.pieces.trailsRemaining > 0 ? legalTrailTargets(state, playerId) : [],
    cottages: player.pieces.cottagesRemaining > 0 ? legalCottageTargets(state, playerId) : [],
    manors: player.pieces.manorsRemaining > 0 ? legalManorTargets(state, playerId) : []
  };
}

export function getPublicGameState(state, viewerPlayerId = null) {
  const players = state.playerOrder.map((playerId) => {
    const player = state.players[playerId];
    const self = playerId === viewerPlayerId;

    return {
      id: player.id,
      name: player.name,
      avatarId: player.avatarId,
      isHost: player.isHost,
      points: getPlayerPoints(state, player),
      resources: self ? { ...player.resources } : null,
      resourceCount: getPlayerResourceCount(player),
      pieces: { ...player.pieces },
      frostEffects: player.frostEffects.map((effect) => ({ ...effect })),
      protectionTurns: player.protectionTurns,
      devCards: self
        ? player.devCards.map((card) => ({ id: card.id, type: card.type, revealed: card.revealed }))
        : { count: player.devCards.length },
      playedDevCards: player.playedDevCards.map((card) => ({ type: card.type, playedAtTurn: card.playedAtTurn }))
    };
  });

  const setupStep = currentSetupStep(state);

  return {
    roomId: state.roomId,
    phase: state.phase,
    hostPlayerId: state.hostPlayerId,
    board: state.board,
    players,
    structures: state.structures,
    playerOrder: [...state.playerOrder],
    setup: state.setup
      ? {
          ...state.setup,
          currentStep: setupStep
        }
      : null,
    vote: {
      ...state.vote,
      votes: { ...state.vote.votes }
    },
    winMode: state.winMode,
    turn: state.turn
      ? {
          ...state.turn,
          activePlayerId: getActivePlayerId(state)
        }
      : null,
    standings: getStandings(state),
    legalActions: viewerPlayerId ? getLegalActions(state, viewerPlayerId) : [],
    fastBuildTargets: viewerPlayerId ? getFastBuildTargets(state, viewerPlayerId) : null,
    bankRatios: viewerPlayerId ? getPlayerBankRatios(state, viewerPlayerId) : null,
    pendingTrades: state.pendingTrades,
    charterClaim: state.charterClaim,
    log: state.log,
    winner: state.winner,
    pendingHostTieBreak: state.pendingHostTieBreak,
    matchStartedAt: state.matchStartedAt,
    endedAt: state.endedAt
  };
}

export function ensureStartedMainPhase(state) {
  if (state.phase === "vote") {
    maybeResolveVote(state);
  }
  if (state.phase === "setup") {
    return false;
  }
  return state.phase === "main";
}

export function createInitializedGameState(opts) {
  const state = createGameState(opts);
  initializeDeck(state);
  return state;
}
