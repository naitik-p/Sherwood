import { describe, expect, test } from "vitest";
import {
  acceptTrade,
  bankTrade,
  buildCottage,
  buildTrail,
  castWinVote,
  createBoard,
  createInitializedGameState,
  endTurn,
  getFastBuildTargets,
  getPublicGameState,
  moveRobber,
  playDevCard,
  proposeTrade,
  resolveSteal,
  rollDice,
  submitDiscard,
  WIN_MODES
} from "../src/index.js";

function createMatch() {
  return createInitializedGameState({
    roomId: "room_test",
    hostPlayerId: "p1",
    seed: "test_seed",
    players: [
      { id: "p1", name: "Ava", avatarId: "badge_1", isHost: true },
      { id: "p2", name: "Milo", avatarId: "badge_2", isHost: false }
    ],
    now: 1_000
  });
}

function forceVoteToFirstToTen(state) {
  castWinVote(state, "p1", WIN_MODES.FIRST_TO_10, 1_010);
  castWinVote(state, "p2", WIN_MODES.FIRST_TO_10, 1_011);
}

function completeSnakeSetup(state) {
  while (state.phase === "setup") {
    const step = state.setup.queue[state.setup.index];
    const targets = getFastBuildTargets(state, step.playerId);
    if (step.type === "cottage") {
      buildCottage(state, step.playerId, targets.cottages[0], 1_100 + state.setup.index);
    } else {
      buildTrail(state, step.playerId, targets.trails[0], 1_100 + state.setup.index);
    }
  }
}

function rngForDice(dieA, dieB) {
  const values = [
    (dieA - 0.2) / 6,
    (dieB - 0.2) / 6
  ];
  let i = 0;
  return () => {
    const value = values[i] ?? 0.2;
    i += 1;
    return value;
  };
}

function pickDiceForTotal(total) {
  const pairs = [
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 4],
    [1, 5],
    [1, 6],
    [2, 6],
    [3, 6],
    [4, 6],
    [5, 6],
    [6, 6]
  ];
  const pair = pairs.find(([a, b]) => a + b === total);
  if (!pair) {
    throw new Error(`No dice pair for total ${total}`);
  }
  return pair;
}

function resetPlayersAndStructures(state) {
  state.structures.intersections = {};
  state.structures.edges = {};
  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    player.cottages = [];
    player.manors = [];
    player.trails = [];
    player.resources = {
      timber: 0,
      clay: 0,
      wool: 0,
      harvest: 0,
      iron: 0
    };
  }
}

function emptyBag() {
  return {
    timber: 0,
    clay: 0,
    wool: 0,
    harvest: 0,
    iron: 0
  };
}

function deltaBag(before, after) {
  return {
    timber: after.timber - before.timber,
    clay: after.clay - before.clay,
    wool: after.wool - before.wool,
    harvest: after.harvest - before.harvest,
    iron: after.iron - before.iron
  };
}

function addBagInPlace(target, gain) {
  target.timber += gain.timber;
  target.clay += gain.clay;
  target.wool += gain.wool;
  target.harvest += gain.harvest;
  target.iron += gain.iron;
}

function expectedSetupPlacementGain(state, intersectionId) {
  const node = state.board.intersections.find((entry) => entry.id === intersectionId);
  const expected = emptyBag();

  for (const hexId of node.hexIds) {
    const hex = state.board.hexes.find((entry) => entry.id === hexId);
    if (hex.resource) {
      expected[hex.resource] += 1;
    }
  }
  return expected;
}

describe("engine rules", () => {
  test("completes two-player snake setup and transitions to main phase", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);
    expect(getFastBuildTargets(state, "p1").manors).toEqual([]);
    completeSnakeSetup(state);

    expect(state.phase).toBe("main");
    expect(state.turn.order[state.turn.index]).toBe("p1");
    expect(state.players.p1.cottages).toHaveLength(2);
    expect(state.players.p2.cottages).toHaveLength(2);
    expect(state.players.p1.trails).toHaveLength(2);
    expect(state.players.p2.trails).toHaveLength(2);
  });

  test("manor fast-build targets are hidden until main phase roll is completed", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);
    const setupTargets = getFastBuildTargets(state, "p1");
    expect(setupTargets.manors).toEqual([]);
    expect(setupTargets.trails).toEqual([]);
    expect(setupTargets.cottages.length).toBeGreaterThan(0);

    completeSnakeSetup(state);
    const activePlayerId = state.turn.order[state.turn.index];
    expect(getFastBuildTargets(state, activePlayerId)).toEqual({ trails: [], cottages: [], manors: [] });

    const [d1, d2] = pickDiceForTotal(6);
    rollDice(state, activePlayerId, 1_900, rngForDice(d1, d2));
    expect(getFastBuildTargets(state, activePlayerId).manors.length).toBeGreaterThan(0);
  });

  test("rejects disconnected trail placements in main phase", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);
    completeSnakeSetup(state);

    const activePlayerId = state.turn.order[state.turn.index];
    state.players[activePlayerId].resources = {
      timber: 5,
      clay: 5,
      wool: 0,
      harvest: 0,
      iron: 0
    };

    const [d1, d2] = pickDiceForTotal(6);
    rollDice(state, activePlayerId, 1_930, rngForDice(d1, d2));

    const legalTrails = new Set(getFastBuildTargets(state, activePlayerId).trails);
    expect(legalTrails.size).toBeGreaterThan(0);

    const disconnected = state.board.edges
      .map((edge) => edge.id)
      .find((edgeId) => !legalTrails.has(edgeId) && !state.structures.edges[edgeId]);

    expect(Boolean(disconnected)).toBe(true);
    expect(() => buildTrail(state, activePlayerId, disconnected, 1_931)).toThrow(/Illegal trail placement/);
  });

  test("grants resources only on second setup cottage (round 2), not first (round 1)", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);

    const expectedTotals = {
      p1: emptyBag(),
      p2: emptyBag()
    };
    const gainedCardCounts = {
      p1: 0,
      p2: 0
    };

    while (state.phase === "setup") {
      const step = state.setup.queue[state.setup.index];
      const targets = getFastBuildTargets(state, step.playerId);

      if (step.type === "cottage") {
        const chosen = targets.cottages[0];
        const before = { ...state.players[step.playerId].resources };

        buildCottage(state, step.playerId, chosen, 1_500 + state.setup.index);

        const after = state.players[step.playerId].resources;
        const observedGain = deltaBag(before, after);

        if (step.round === 1) {
          // First cottage: no resources granted
          expect(observedGain).toEqual(emptyBag());
        } else {
          // Second cottage: resources granted for each adjacent producing hex
          const expectedGain = expectedSetupPlacementGain(state, chosen);
          expect(observedGain).toEqual(expectedGain);
          addBagInPlace(expectedTotals[step.playerId], expectedGain);
          gainedCardCounts[step.playerId] += Object.values(expectedGain).reduce((sum, amount) => sum + amount, 0);
        }
      } else {
        buildTrail(state, step.playerId, targets.trails[0], 1_500 + state.setup.index);
      }
    }

    expect(state.players.p1.resources).toEqual(expectedTotals.p1);
    expect(state.players.p2.resources).toEqual(expectedTotals.p2);
    // Each player gets resources only from their round-2 cottage
    expect(gainedCardCounts.p1).toBeGreaterThanOrEqual(0);
    expect(gainedCardCounts.p2).toBeGreaterThanOrEqual(0);
  });

  test("builds exactly 9 coastal markets with 5 specific 2:1 and 4 generic 3:1 ratios", () => {
    const state = createMatch();
    const stallNodes = state.board.intersections.filter((node) => Boolean(node.stall));
    const stalls = stallNodes.map((node) => node.stall);

    expect(stallNodes).toHaveLength(9);
    expect(stallNodes.every((node) => node.coastal)).toBe(true);
    expect(stallNodes.every((node) => node.hexIds.length < 3)).toBe(true);

    const specific2to1 = stalls.filter((stall) => stall.kind === "specific" && stall.ratio === 2);
    const generic3to1 = stalls.filter((stall) => stall.kind === "generic" && stall.ratio === 3);
    const illegal = stalls.filter((stall) => !(stall.ratio === 2 || stall.ratio === 3));

    expect(specific2to1).toHaveLength(5);
    expect(generic3to1).toHaveLength(4);
    expect(illegal).toHaveLength(0);
    expect(new Set(specific2to1.map((stall) => stall.resource))).toEqual(new Set(["timber", "clay", "wool", "harvest", "iron"]));
  });

  test("port positions are identical across two game instances", () => {
    const a = createBoard({ hexSize: 84 });
    const b = createBoard({ hexSize: 84 });

    const posA = a.intersections
      .filter((n) => n.stall)
      .map((n) => `${n.x},${n.y}`)
      .sort();
    const posB = b.intersections
      .filter((n) => n.stall)
      .map((n) => `${n.x},${n.y}`)
      .sort();

    expect(posA).toHaveLength(9);
    expect(posA).toEqual(posB);

    const mapA = new Map(
      a.intersections
        .filter((n) => n.stall)
        .map((n) => [`${n.x},${n.y}`, `${n.stall.kind}:${n.stall.resource ?? "*"}:${n.stall.ratio}`])
    );
    const mapB = new Map(
      b.intersections
        .filter((n) => n.stall)
        .map((n) => [`${n.x},${n.y}`, `${n.stall.kind}:${n.stall.resource ?? "*"}:${n.stall.ratio}`])
    );

    expect([...mapA.entries()].sort()).toEqual([...mapB.entries()].sort());

    const coastalOnly = a.intersections.filter((n) => n.stall).every((n) => n.coastal);
    expect(coastalOnly).toBe(true);
  });

  test("enforces spacing rule for cottage placement", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);

    const p1Cottage = getFastBuildTargets(state, "p1").cottages[0];
    buildCottage(state, "p1", p1Cottage, 1_020);

    const p1Trail = getFastBuildTargets(state, "p1").trails[0];
    buildTrail(state, "p1", p1Trail, 1_021);

    const adjacentNode = state.board.intersections.find((node) => node.id === p1Cottage).adjacentIntersectionIds[0];

    expect(() => buildCottage(state, "p2", adjacentNode, 1_022)).toThrow(/Illegal cottage placement/);
  });

  test("distributes production for matching token with cottage and manor yields", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);
    completeSnakeSetup(state);
    resetPlayersAndStructures(state);

    const targetHex = state.board.hexes.find((hex) => hex.resource && hex.token !== 2);
    const [ix1, ix2] = targetHex.intersectionIds;

    state.structures.intersections[ix1] = { ownerId: "p1", type: "cottage" };
    state.structures.intersections[ix2] = { ownerId: "p2", type: "manor" };
    state.players.p1.cottages = [ix1];
    state.players.p2.manors = [ix2];

    const [d1, d2] = pickDiceForTotal(targetHex.token);
    rollDice(state, "p1", 2_000, rngForDice(d1, d2));

    expect(state.players.p1.resources[targetHex.resource]).toBe(1);
    expect(state.players.p2.resources[targetHex.resource]).toBe(2);
  });

  test("frost lasts exactly two turns of the affected player", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);
    completeSnakeSetup(state);

    const roller = state.players.p1;
    if (roller.cottages.length === 0 && roller.manors.length === 0) {
      throw new Error("Expected player to have a setup structure");
    }

    rollDice(state, "p1", 3_000, rngForDice(1, 1));
    expect(roller.frostEffects.length).toBe(1);
    expect(roller.frostEffects[0].remainingTurns).toBe(2);

    endTurn(state, "p1", 3_001);
    expect(roller.frostEffects[0].remainingTurns).toBe(1);

    rollDice(state, "p2", 3_002, rngForDice(3, 3));
    endTurn(state, "p2", 3_003);

    rollDice(state, "p1", 3_004, rngForDice(3, 4));
    endTurn(state, "p1", 3_005);

    expect(roller.frostEffects.length).toBe(0);
  });

  test("charter claim blocks other players from receiving production on claimed hex", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);
    completeSnakeSetup(state);
    resetPlayersAndStructures(state);

    const targetHex = state.board.hexes.find((hex) => hex.resource && hex.token !== 2);
    const [ix1, ix2] = targetHex.intersectionIds;

    state.structures.intersections[ix1] = { ownerId: "p1", type: "cottage" };
    state.structures.intersections[ix2] = { ownerId: "p2", type: "cottage" };
    state.players.p1.cottages = [ix1];
    state.players.p2.cottages = [ix2];

    const charterCard = {
      id: "dev_charter",
      type: "charter_claim",
      acquiredOnTurn: 0,
      revealed: false
    };
    state.players.p1.devCards.push(charterCard);

    const rollToken = targetHex.token;
    const [d1, d2] = pickDiceForTotal(rollToken);

    state.turn.rolled = true;
    playDevCard(state, "p1", { cardId: charterCard.id, hexId: targetHex.id }, 4_000);
    endTurn(state, "p1", 4_001);

    rollDice(state, "p2", 4_002, rngForDice(3, 3));
    endTurn(state, "p2", 4_003);

    rollDice(state, "p1", 4_004, rngForDice(d1, d2));

    expect(state.players.p1.resources[targetHex.resource]).toBe(1);
    expect(state.players.p2.resources[targetHex.resource]).toBe(0);
  });

  test("trade offers follow turn/roll timing and acceptance remains atomic", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);
    completeSnakeSetup(state);

    const activePlayerId = state.turn.order[state.turn.index];
    const waitingPlayerId = state.turn.order[(state.turn.index + 1) % state.turn.order.length];
    expect(activePlayerId).toBe("p1");
    expect(waitingPlayerId).toBe("p2");

    const preRollState = getPublicGameState(state, activePlayerId);
    expect(preRollState.legalActions).toContain("rollDice");
    expect(preRollState.legalActions).not.toContain("proposeTrade");

    const waitingState = getPublicGameState(state, waitingPlayerId);
    expect(waitingState.legalActions).toEqual(["acceptTrade", "declineTrade"]);

    state.players.p1.resources.timber = 1;
    state.players.p2.resources.iron = 0;

    expect(() =>
      proposeTrade(
        state,
        "p1",
        {
          toPlayerId: "p2",
          give: { timber: 1 },
          receive: { iron: 1 }
        },
        5_000
      )
    ).toThrow(/Roll dice before posting a trade offer/);

    const [d1, d2] = pickDiceForTotal(6);
    rollDice(state, "p1", 5_000, rngForDice(d1, d2));

    const afterRollState = getPublicGameState(state, activePlayerId);
    expect(afterRollState.legalActions).toContain("proposeTrade");

    const offer = proposeTrade(
      state,
      "p1",
      {
        toPlayerId: "p2",
        give: { timber: 1 },
        receive: { iron: 1 }
      },
      5_001
    );

    const p1TimberBeforeFailedAccept = state.players.p1.resources.timber;
    const p2TimberBeforeFailedAccept = state.players.p2.resources.timber;
    expect(() => acceptTrade(state, "p2", offer.id, 5_002)).toThrow(/Acceptor lacks resources/);
    expect(state.players.p1.resources.timber).toBe(p1TimberBeforeFailedAccept);
    expect(state.players.p2.resources.timber).toBe(p2TimberBeforeFailedAccept);

    state.players.p2.resources.iron = 1;
    const p1TimberBeforeAccept = state.players.p1.resources.timber;
    const p2TimberBeforeAccept = state.players.p2.resources.timber;
    const p1IronBeforeAccept = state.players.p1.resources.iron;
    const p2IronBeforeAccept = state.players.p2.resources.iron;
    acceptTrade(state, "p2", offer.id, 5_003);

    expect(state.players.p1.resources.timber).toBe(p1TimberBeforeAccept - 1);
    expect(state.players.p2.resources.timber).toBe(p2TimberBeforeAccept + 1);
    expect(state.players.p1.resources.iron).toBe(p1IronBeforeAccept + 1);
    expect(state.players.p2.resources.iron).toBe(p2IronBeforeAccept - 1);
  });

  test("dice rolls vary over turns and always stay in the 2..12 range", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);
    completeSnakeSetup(state);

    const rolls = [];

    for (let i = 0; i < 14; i += 1) {
      const activePlayerId = state.turn.order[state.turn.index];
      const { roll } = rollDice(state, activePlayerId, 6_000 + i);
      rolls.push(roll);
      endTurn(state, activePlayerId, 6_100 + i);
    }

    const unique = new Set(rolls);
    expect(unique.size).toBeGreaterThan(1);
    expect(Math.min(...rolls)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...rolls)).toBeLessThanOrEqual(12);
  });

  test("after rolling, the active player can build, bank-trade, and end turn", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);
    completeSnakeSetup(state);

    const activePlayerId = state.turn.order[state.turn.index];
    const activePlayer = state.players[activePlayerId];
    activePlayer.resources = {
      timber: 12,
      clay: 12,
      wool: 4,
      harvest: 6,
      iron: 4
    };

    const [d1, d2] = pickDiceForTotal(6);
    rollDice(state, activePlayerId, 7_000, rngForDice(d1, d2));

    const postRoll = getPublicGameState(state, activePlayerId);
    expect(postRoll.legalActions).toContain("buildTrail");
    expect(postRoll.legalActions).toContain("buildCottage");
    expect(postRoll.legalActions).toContain("bankTrade");
    expect(postRoll.legalActions).toContain("endTurn");

    const trailTarget = postRoll.fastBuildTargets.trails[0];
    expect(Boolean(trailTarget)).toBe(true);
    buildTrail(state, activePlayerId, trailTarget, 7_001);

    const afterTrail = getPublicGameState(state, activePlayerId);
    const ratios = afterTrail.bankRatios;
    const giveResource =
      Object.keys(ratios).find((resource) => activePlayer.resources[resource] >= ratios[resource]) || "timber";
    const receiveResource = ["timber", "clay", "wool", "harvest", "iron"].find((resource) => resource !== giveResource) || "clay";
    const giveAmount = ratios[giveResource];
    const beforeGive = activePlayer.resources[giveResource];
    const beforeReceive = activePlayer.resources[receiveResource];

    bankTrade(
      state,
      activePlayerId,
      {
        giveResource,
        receiveResource,
        receiveAmount: 1,
        giveAmount
      },
      7_002
    );

    expect(activePlayer.resources[giveResource]).toBe(beforeGive - giveAmount);
    expect(activePlayer.resources[receiveResource]).toBe(beforeReceive + 1);

    endTurn(state, activePlayerId, 7_003);
    expect(state.turn.order[state.turn.index]).not.toBe(activePlayerId);
  });

  describe("robber state", () => {
    test("ROBBER-01: createGameState initializes robberHexId to the wild_heath hex", () => {
      const state = createMatch();
      const wildHeathHex = state.board.hexes.find((h) => h.terrainId === "wild_heath");
      expect(wildHeathHex).toBeDefined();
      expect(state.robberHexId).toBe(wildHeathHex.id);
    });

    test("ROBBER-02: rolling the robber hex token produces nothing; other hexes produce normally", () => {
      const state = createMatch();
      forceVoteToFirstToTen(state);
      completeSnakeSetup(state);
      resetPlayersAndStructures(state);

      // Pick a producing hex to park the robber on (token !== 2 avoids frost early-return)
      const robberHex = state.board.hexes.find((h) => h.resource && h.token && h.token !== 2);
      state.robberHexId = robberHex.id;

      // Place p1 cottage on the robber hex — should receive nothing when rolled
      const blockedIx = robberHex.intersectionIds[0];
      state.structures.intersections[blockedIx] = { ownerId: "p1", type: "cottage" };
      state.players.p1.cottages = [blockedIx];

      const [d1, d2] = pickDiceForTotal(robberHex.token);
      rollDice(state, "p1", 4_000, rngForDice(d1, d2));

      expect(state.players.p1.resources[robberHex.resource]).toBe(0);

      // Now move robber away and verify the same hex produces normally
      const otherHex = state.board.hexes.find((h) => h.resource && h.token && h.token !== 2 && h.id !== robberHex.id);
      state.robberHexId = otherHex.id;

      endTurn(state, "p1", 4_001);

      const [d3, d4] = pickDiceForTotal(robberHex.token);
      rollDice(state, "p2", 4_002, rngForDice(d3, d4));

      expect(state.players.p1.resources[robberHex.resource]).toBe(1);
    });
  });

  describe("roll 7 sequence", () => {
    function makeMainState() {
      const state = createMatch();
      forceVoteToFirstToTen(state);
      completeSnakeSetup(state);
      resetPlayersAndStructures(state);
      return state;
    }

    function findHexByTerrain(state, terrainId) {
      return state.board.hexes.find((h) => h.terrainId === terrainId);
    }

    function findProducingHex(state) {
      return state.board.hexes.find((h) => h.resource && h.token && h.token !== 2);
    }

    // ── ROLL7-01 ─────────────────────────────────────────────────────────

    test("roll=7 with player holding 14 cards sets pendingDiscards.required", () => {
      const state = makeMainState();
      state.players.p1.resources.timber = 14;
      rollDice(state, "p1", 5_000, rngForDice(...pickDiceForTotal(7)));
      expect(state.turn.pendingDiscards).not.toBeNull();
      expect(state.turn.pendingDiscards.required["p1"]).toBe(7); // floor(14/2)
    });

    test("roll=7 with no player holding 7+ cards skips discards and sets pendingRobberMove", () => {
      const state = makeMainState();
      rollDice(state, "p1", 5_010, rngForDice(...pickDiceForTotal(7)));
      expect(state.turn.pendingDiscards).toBeNull();
      expect(state.turn.pendingRobberMove).toBe(true);
    });

    test("submitDiscard rejects wrong card count", () => {
      const state = makeMainState();
      state.players.p1.resources.timber = 8; // must discard 4
      rollDice(state, "p1", 5_020, rngForDice(...pickDiceForTotal(7)));
      expect(() =>
        submitDiscard(state, "p1", { timber: 3, clay: 0, wool: 0, harvest: 0, iron: 0 })
      ).toThrow("Must discard exactly 4 cards");
    });

    test("submitDiscard removes cards and records submission", () => {
      const state = makeMainState();
      state.players.p1.resources.timber = 8;
      rollDice(state, "p1", 5_030, rngForDice(...pickDiceForTotal(7)));
      submitDiscard(state, "p1", { timber: 4, clay: 0, wool: 0, harvest: 0, iron: 0 });
      expect(state.players.p1.resources.timber).toBe(4);
      expect(state.turn.pendingDiscards).toBeNull(); // only one required player — should clear
      expect(state.turn.pendingRobberMove).toBe(true);
    });

    test("endTurn blocked while pendingDiscards is non-null", () => {
      const state = makeMainState();
      state.players.p1.resources.timber = 8;
      rollDice(state, "p1", 5_040, rngForDice(...pickDiceForTotal(7)));
      expect(() => endTurn(state, "p1", 5_041)).toThrow("Discards must be resolved");
    });

    // ── ROLL7-02 ─────────────────────────────────────────────────────────

    test("moveRobber to wild_heath throws", () => {
      const state = makeMainState();
      rollDice(state, "p1", 5_050, rngForDice(...pickDiceForTotal(7)));
      const wildHex = findHexByTerrain(state, "wild_heath");
      expect(() => moveRobber(state, "p1", wildHex.id)).toThrow("Robber cannot be placed on Wild Heath");
    });

    test("moveRobber to valid hex updates robberHexId and clears pendingRobberMove", () => {
      const state = makeMainState();
      rollDice(state, "p1", 5_060, rngForDice(...pickDiceForTotal(7)));
      const target = state.board.hexes.find((h) => h.resource && h.token && h.id !== state.robberHexId);
      moveRobber(state, "p1", target.id);
      expect(state.robberHexId).toBe(target.id);
      expect(state.turn.pendingRobberMove).toBeNull();
    });

    test("endTurn blocked while pendingRobberMove is non-null", () => {
      const state = makeMainState();
      rollDice(state, "p1", 5_070, rngForDice(...pickDiceForTotal(7)));
      expect(() => endTurn(state, "p1", 5_071)).toThrow("Robber must be moved");
    });

    // ── ROLL7-03 ─────────────────────────────────────────────────────────

    test("moveRobber sets pendingSteal when eligible player is on hex", () => {
      const state = makeMainState();
      rollDice(state, "p1", 5_080, rngForDice(...pickDiceForTotal(7)));
      const target = state.board.hexes.find((h) => h.resource && h.token && h.id !== state.robberHexId);
      const ixId = target.intersectionIds[0];
      state.structures.intersections[ixId] = { ownerId: "p2", type: "cottage" };
      state.players.p2.resources.timber = 1;
      moveRobber(state, "p1", target.id);
      expect(state.turn.pendingSteal).not.toBeNull();
      expect(state.turn.pendingSteal.eligiblePlayerIds).toContain("p2");
    });

    test("resolveSteal transfers one card from victim to active player", () => {
      const state = makeMainState();
      rollDice(state, "p1", 5_090, rngForDice(...pickDiceForTotal(7)));
      const target = state.board.hexes.find((h) => h.resource && h.token && h.id !== state.robberHexId);
      const ixId = target.intersectionIds[0];
      state.structures.intersections[ixId] = { ownerId: "p2", type: "cottage" };
      state.players.p2.resources.timber = 2;
      moveRobber(state, "p1", target.id);
      const p2Before = { ...state.players.p2.resources };
      const p1Before = { ...state.players.p1.resources };
      resolveSteal(state, "p1", 5_091, () => 0);
      const p2After = state.players.p2.resources;
      const p1After = state.players.p1.resources;
      const totalStolen = Object.keys(p2Before).reduce((sum, k) => sum + (p2Before[k] - p2After[k]), 0);
      const totalGained = Object.keys(p1After).reduce((sum, k) => sum + (p1After[k] - p1Before[k]), 0);
      expect(totalStolen).toBe(1);
      expect(totalGained).toBe(1);
      expect(state.turn.pendingSteal).toBeNull();
    });

    test("moveRobber with no eligible player auto-skips steal (pendingSteal stays null)", () => {
      const state = makeMainState();
      rollDice(state, "p1", 5_100, rngForDice(...pickDiceForTotal(7)));
      const target = state.board.hexes.find((h) => h.resource && h.token && h.id !== state.robberHexId);
      moveRobber(state, "p1", target.id);
      expect(state.turn.pendingSteal).toBeNull();
    });

    test("endTurn blocked while pendingSteal is non-null", () => {
      const state = makeMainState();
      rollDice(state, "p1", 5_110, rngForDice(...pickDiceForTotal(7)));
      const target = state.board.hexes.find((h) => h.resource && h.token && h.id !== state.robberHexId);
      const ixId = target.intersectionIds[0];
      state.structures.intersections[ixId] = { ownerId: "p2", type: "cottage" };
      state.players.p2.resources.timber = 1;
      moveRobber(state, "p1", target.id);
      expect(() => endTurn(state, "p1", 5_111)).toThrow("Steal must be resolved");
    });
  });
});
