import { describe, expect, test } from "vitest";
import {
  acceptTrade,
  buildCottage,
  buildTrail,
  castWinVote,
  createInitializedGameState,
  endTurn,
  getFastBuildTargets,
  playDevCard,
  proposeTrade,
  rollDice,
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

describe("engine rules", () => {
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

  test("trade acceptance is atomic and validated at execution time", () => {
    const state = createMatch();
    forceVoteToFirstToTen(state);

    state.players.p1.resources.timber = 1;
    state.players.p2.resources.iron = 0;

    const offer = proposeTrade(
      state,
      "p1",
      {
        toPlayerId: "p2",
        give: { timber: 1 },
        receive: { iron: 1 }
      },
      5_000
    );

    expect(() => acceptTrade(state, "p2", offer.id, 5_001)).toThrow(/Acceptor lacks resources/);
    expect(state.players.p1.resources.timber).toBe(1);
    expect(state.players.p2.resources.timber).toBe(0);

    state.players.p2.resources.iron = 1;
    acceptTrade(state, "p2", offer.id, 5_002);

    expect(state.players.p1.resources.timber).toBe(0);
    expect(state.players.p2.resources.timber).toBe(1);
    expect(state.players.p1.resources.iron).toBe(1);
    expect(state.players.p2.resources.iron).toBe(0);
  });
});
