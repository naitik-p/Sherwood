import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  buildCottage as coreBuildCottage,
  buildTrail as coreBuildTrail,
  castWinVote as coreCastWinVote,
  createInitializedGameState,
  getFastBuildTargets as coreGetFastBuildTargets,
  WIN_MODES
} from '@shorewood/core';

const BASE_URL = 'http://localhost:5173';
const RESOURCES = ['timber', 'clay', 'wool', 'harvest', 'iron'];
const MAX_ATTEMPTS = 8;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastLog(state) {
  const logs = state?.log_tail || [];
  return logs.length > 0 ? logs[logs.length - 1] : '';
}

function missingForCottage(resources) {
  const cost = { timber: 1, clay: 1, wool: 1, harvest: 1 };
  const missing = [];
  for (const resource of Object.keys(cost)) {
    const short = cost[resource] - (resources?.[resource] || 0);
    if (short > 0) {
      missing.push(resource);
    }
  }
  return missing;
}

function pickTradeGiveResource(resources, preferredKeep = []) {
  const keep = new Set(preferredKeep);

  const surplus = RESOURCES.filter((resource) => {
    const count = resources?.[resource] || 0;
    if (count <= 0) {
      return false;
    }
    if (keep.has(resource)) {
      return count > 1;
    }
    return true;
  }).sort((a, b) => (resources[b] || 0) - (resources[a] || 0));

  if (surplus.length > 0) {
    return surplus[0];
  }

  const any = RESOURCES.filter((resource) => (resources?.[resource] || 0) > 0).sort(
    (a, b) => (resources[b] || 0) - (resources[a] || 0)
  );
  return any[0] || null;
}

function setupScore(resources) {
  const cottageReady = (resources.timber || 0) >= 1 && (resources.clay || 0) >= 1 && (resources.wool || 0) >= 1 && (resources.harvest || 0) >= 1;
  const cottageAndTrailReady =
    (resources.timber || 0) >= 2 &&
    (resources.clay || 0) >= 2 &&
    (resources.wool || 0) >= 1 &&
    (resources.harvest || 0) >= 1;

  return (
    (cottageAndTrailReady ? 250000 : 0) +
    (cottageReady ? 120000 : 0) +
    Math.min(resources.timber || 0, 2) * 1200 +
    Math.min(resources.clay || 0, 2) * 1200 +
    Math.min(resources.wool || 0, 1) * 1000 +
    Math.min(resources.harvest || 0, 1) * 1000 +
    Math.min(resources.iron || 0, 1) * 200 +
    Object.values(resources || {}).reduce((sum, value) => sum + Number(value || 0), 0)
  );
}

function planSetupSequence(seed) {
  const players = [
    { id: 'p1', name: 'HostPlanner', avatarId: 'badge_1', isHost: true },
    { id: 'p2', name: 'BluePlanner', avatarId: 'badge_2', isHost: false },
    { id: 'p3', name: 'GreenPlanner', avatarId: 'badge_3', isHost: false },
    { id: 'p4', name: 'RedPlanner', avatarId: 'badge_4', isHost: false }
  ];

  const initial = createInitializedGameState({
    roomId: 'room_plan',
    hostPlayerId: 'p1',
    players,
    seed,
    now: 1_000
  });
  coreCastWinVote(initial, 'p1', WIN_MODES.HIGHEST_AT_60, 1_010);
  coreCastWinVote(initial, 'p2', WIN_MODES.HIGHEST_AT_60, 1_011);
  coreCastWinVote(initial, 'p3', WIN_MODES.HIGHEST_AT_60, 1_012);
  coreCastWinVote(initial, 'p4', WIN_MODES.HIGHEST_AT_60, 1_013);

  let best = { score: -Infinity, sequence: null };

  function dfs(state, sequence) {
    if (state.phase !== 'setup') {
      if (state.phase === 'main') {
        const resources = state.players.p1.resources || {};
        const score = setupScore(resources);
        if (score > best.score) {
          best = { score, sequence: [...sequence] };
        }
      }
      return;
    }

    const step = state.setup?.queue?.[state.setup.index];
    if (!step) {
      return;
    }

    const key = step.type === 'cottage' ? 'cottages' : 'trails';
    const targets = coreGetFastBuildTargets(state, step.playerId)?.[key] || [];
    if (targets.length === 0) {
      return;
    }

    const branchTargets = step.playerId === 'p1' ? targets : [targets[0]];
    for (const targetId of branchTargets) {
      const cloned = structuredClone(state);
      if (step.type === 'cottage') {
        coreBuildCottage(cloned, step.playerId, targetId, 2_000 + sequence.length);
      } else {
        coreBuildTrail(cloned, step.playerId, targetId, 2_000 + sequence.length);
      }
      sequence.push(targetId);
      dfs(cloned, sequence);
      sequence.pop();
    }
  }

  dfs(initial, []);
  if (!best.sequence || best.sequence.length !== 16) {
    throw new Error('Failed to compute setup plan');
  }
  return best.sequence;
}

async function getTextState(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function clickOption(page, labelPart) {
  const option = page.locator('.option-item', { hasText: labelPart }).first();
  await option.waitFor({ state: 'visible', timeout: 9000 });
  await option.click();
}

async function getHighlightedIds(page, type) {
  const selector = type === 'cottage' ? '.intersection.highlight' : '.edge.highlight';
  const attr = type === 'cottage' ? 'data-intersection-id' : 'data-edge-id';

  return page.evaluate(
    ({ localSelector, localAttr }) => {
      const nodes = [...document.querySelectorAll(localSelector)];
      return nodes
        .filter((node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && (rect.width > 0 || rect.height > 0);
        })
        .map((node) => node.getAttribute(localAttr))
        .filter(Boolean);
    },
    { localSelector: selector, localAttr: attr }
  );
}

async function clickHighlightedPlacement(page, type, preferredId = null) {
  const attr = type === 'cottage' ? 'data-intersection-id' : 'data-edge-id';
  const ids = await getHighlightedIds(page, type);
  if (!ids.length) {
    return false;
  }

  const id = preferredId && ids.includes(preferredId) ? preferredId : ids[0];

  await page.evaluate(
    ({ localAttr, localId }) => {
      const node = document.querySelector(`[${localAttr}='${localId}']`);
      if (!node) {
        throw new Error(`Target not found for ${localId}`);
      }
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    },
    { localAttr: attr, localId: id }
  );

  const confirm = page.locator('#confirm-placement');
  await confirm.waitFor({ state: 'visible', timeout: 2500 });
  await confirm.click({ force: true });
  await sleep(120);
  return true;
}

async function ensureStepOnPage(page, step) {
  await page.waitForFunction(
    ({ playerId, type, round }) => {
      const payload = JSON.parse(window.render_game_to_text());
      return (
        payload.mode === 'setup' &&
        payload.setup_step &&
        payload.setup_step.playerId === playerId &&
        payload.setup_step.type === type &&
        payload.setup_step.round === round
      );
    },
    step,
    { timeout: 7000 }
  );
}

async function waitStepAdvance(hostPage, priorStep) {
  await hostPage.waitForFunction(
    ({ playerId, type, round }) => {
      const payload = JSON.parse(window.render_game_to_text());
      if (payload.mode !== 'setup') {
        return true;
      }
      if (!payload.setup_step) {
        return false;
      }
      return !(
        payload.setup_step.playerId === playerId &&
        payload.setup_step.type === type &&
        payload.setup_step.round === round
      );
    },
    priorStep,
    { timeout: 7000 }
  );
}

async function buildIfPossible(activePage, type) {
  const label = type === 'cottage' ? 'Build Cottage' : 'Build Road';
  const expectedLog = type === 'cottage' ? /placed a Cottage/i : /placed a Trail/i;
  const selector = type === 'cottage' ? '.intersection.highlight' : '.edge.highlight';
  const before = await getTextState(activePage);
  const beforeLast = lastLog(before);

  await clickOption(activePage, label);
  await sleep(120);

  const highlightCount = await activePage.locator(selector).count();
  if (highlightCount <= 0) {
    return false;
  }

  const clicked = await clickHighlightedPlacement(activePage, type);
  if (!clicked) {
    return false;
  }

  await sleep(180);
  const after = await getTextState(activePage);
  const afterLast = lastLog(after);
  return afterLast !== beforeLast && expectedLog.test(afterLast);
}

async function attemptTrade(activePage, playerPages, activeId, preferredReceives = []) {
  const activeState = await getTextState(activePage);
  const activeResources = activeState?.me?.resources || {};
  const missing = missingForCottage(activeResources);
  const receivePriorities = [
    ...preferredReceives,
    ...missing.filter((resource) => !preferredReceives.includes(resource)),
    ...RESOURCES.filter((resource) => !preferredReceives.includes(resource) && !missing.includes(resource))
  ];

  const otherStates = {};
  for (const [playerId, page] of Object.entries(playerPages)) {
    if (playerId === activeId) {
      continue;
    }
    otherStates[playerId] = await getTextState(page);
  }

  let offer = null;
  for (const receiveResource of receivePriorities) {
    for (const [targetId, targetState] of Object.entries(otherStates)) {
      const targetResources = targetState?.me?.resources || {};
      if ((targetResources[receiveResource] || 0) <= 0) {
        continue;
      }

      const giveResource = pickTradeGiveResource(activeResources, missing);
      if (giveResource && giveResource !== receiveResource) {
        offer = {
          toPlayerId: targetId,
          giveResource,
          receiveResource
        };
        break;
      }
    }
    if (offer) {
      break;
    }
  }

  if (!offer) {
    return false;
  }

  const before = await getTextState(activePage);
  const beforeLast = lastLog(before);

  await activePage.selectOption('#trade-to-player', offer.toPlayerId);
  await activePage.selectOption('#trade-give-resource', offer.giveResource);
  await activePage.fill('#trade-give-amount', '1');
  await activePage.selectOption('#trade-receive-resource', offer.receiveResource);
  await activePage.fill('#trade-receive-amount', '1');
  await activePage.click('#submit-trade');

  const targetPage = playerPages[offer.toPlayerId];
  try {
    await targetPage.locator('[data-accept-trade]').first().waitFor({ state: 'visible', timeout: 3000 });
    await targetPage.locator('[data-accept-trade]').first().click();
  } catch {
    return false;
  }

  await sleep(220);
  const after = await getTextState(activePage);
  const afterLast = lastLog(after);
  return afterLast !== beforeLast && /accepted a trade/i.test(afterLast);
}

async function attemptBankTrade(activePage) {
  const before = await getTextState(activePage);
  const resources = before?.me?.resources || {};
  const beforeLast = lastLog(before);

  const ratios = await activePage.evaluate(() => {
    const map = {};
    const buttons = [...document.querySelectorAll('[data-bank-template]')];
    for (const button of buttons) {
      const raw = button.getAttribute('data-bank-template') || '';
      const [giveResource, , ratioText] = raw.split(':');
      const ratio = Number(ratioText);
      if (giveResource && Number.isFinite(ratio) && ratio > 0) {
        map[giveResource] = ratio;
      }
    }
    return map;
  });

  const missing = missingForCottage(resources);
  const preferredReceives = [...missing, ...RESOURCES.filter((resource) => !missing.includes(resource))];
  let selectedGive = null;
  let selectedReceive = null;

  const giveCandidates = RESOURCES.filter((resource) => {
    const ratio = ratios[resource];
    if (!Number.isFinite(ratio)) {
      return false;
    }
    if ((resources[resource] || 0) < ratio) {
      return false;
    }
    if (missing.includes(resource) && (resources[resource] || 0) <= 1) {
      return false;
    }
    return true;
  }).sort((a, b) => (resources[b] || 0) - (resources[a] || 0));

  for (const giveResource of giveCandidates) {
    for (const receiveResource of preferredReceives) {
      if (receiveResource !== giveResource) {
        selectedGive = giveResource;
        selectedReceive = receiveResource;
        break;
      }
    }
    if (selectedGive) {
      break;
    }
  }

  if (!selectedGive || !selectedReceive) {
    return false;
  }

  await activePage.selectOption('#bank-give', selectedGive);
  await activePage.selectOption('#bank-receive', selectedReceive);
  await activePage.click('#do-bank-trade');
  await sleep(220);

  const after = await getTextState(activePage);
  const afterLast = lastLog(after);
  return afterLast !== beforeLast && /with the Bazaar/i.test(afterLast);
}

async function attemptBuyDevCard(activePage) {
  const before = await getTextState(activePage);
  const beforeCount = (before?.me?.dev_cards || []).length;

  await clickOption(activePage, 'Buy Development Card');
  await sleep(180);

  const after = await getTextState(activePage);
  const afterCount = (after?.me?.dev_cards || []).length;
  return afterCount > beforeCount;
}

async function runSingleAttempt(browser, attemptIndex) {
  const contexts = [];
  const pages = [];

  const summary = {
    attempt: attemptIndex,
    roomId: null,
    turnsCompleted: 0,
    trailsBuilt: 0,
    cottagesBuilt: 0,
    playerTradesAccepted: 0,
    bankTradesCompleted: 0,
    devCardsBought: 0,
    uniqueRollCount: 0,
    perTurn: []
  };

  try {
    for (let i = 0; i < 4; i += 1) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      pages.push(await ctx.newPage());
    }

    const [hostPage, guest2Page, guest3Page, guest4Page] = pages;

    await hostPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await hostPage.fill('#name-input', `HostP1-A${attemptIndex}`);
    await hostPage.click('#save-profile');
    await hostPage.click('#create-room-btn');
    await hostPage.locator('text=Shorewood Lobby').waitFor({ timeout: 10000 });

    const roomId = new URL(hostPage.url()).searchParams.get('room');
    if (!roomId) {
      throw new Error('Failed to get room id from host URL');
    }
    summary.roomId = roomId;
    const setupPlan = planSetupSequence(roomId);

    const guestConfigs = [
      { page: guest2Page, name: `BlueP2-A${attemptIndex}` },
      { page: guest3Page, name: `GreenP3-A${attemptIndex}` },
      { page: guest4Page, name: `RedP4-A${attemptIndex}` }
    ];

    for (const guest of guestConfigs) {
      await guest.page.goto(`${BASE_URL}/?room=${roomId}`, { waitUntil: 'domcontentloaded' });
      await guest.page.fill('#name-input', guest.name);
      await guest.page.click('#save-profile');
      await guest.page.click('#join-room-btn');
      await sleep(80);
    }

    await hostPage.locator('[data-admit]').first().waitFor({ state: 'visible', timeout: 10000 });
    for (let i = 0; i < 3; i += 1) {
      await hostPage.locator('[data-admit]').first().click();
      await sleep(120);
    }

    for (const page of pages) {
      await page.locator('#toggle-ready').waitFor({ state: 'visible', timeout: 10000 });
      await page.click('#toggle-ready');
    }

    await hostPage.click('#start-match');

    for (const page of pages) {
      await clickOption(page, 'Vote: Highest at 60 minutes');
    }

    await hostPage.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === 'setup', null, { timeout: 10000 });

    const playerPages = {};
    for (const page of pages) {
      const id = (await getTextState(page)).me?.id;
      if (!id) {
        throw new Error('Player id missing in text state');
      }
      playerPages[id] = page;
    }

    for (let i = 0; i < 16; i += 1) {
      const hostState = await getTextState(hostPage);
      if (hostState.mode !== 'setup') {
        break;
      }

      const step = hostState.setup_step;
      const actorPage = playerPages[step.playerId];
      if (!actorPage) {
        throw new Error(`Missing setup actor page for ${step.playerId}`);
      }

      await ensureStepOnPage(actorPage, step);
      const expectedTarget = setupPlan[i] || null;
      const placed = await clickHighlightedPlacement(actorPage, step.type, expectedTarget);
      if (!placed) {
        throw new Error(`No setup target available at step ${i}`);
      }
      await waitStepAdvance(hostPage, step);
    }

    const postSetup = await getTextState(hostPage);
    if (postSetup.mode !== 'main') {
      throw new Error('Game did not reach main phase after setup');
    }

    const uniqueRolls = new Set();

    while (summary.turnsCompleted < 6) {
      const hostState = await getTextState(hostPage);
      if (hostState.mode !== 'main') {
        throw new Error(`Game left main phase unexpectedly: ${hostState.mode}`);
      }

      const activeId = hostState.active_player_id;
      const activePage = playerPages[activeId];
      if (!activePage) {
        throw new Error(`No active page for ${activeId}`);
      }

      const turnAction = {
        turnNumber: summary.turnsCompleted + 1,
        activePlayerId: activeId,
        rolled: false,
        tradeAccepted: false,
        cottageBuilt: false,
        trailBuilt: false,
        bankTradeCompleted: false,
        devBought: false
      };
      const turnsRemainingAfterThis = 6 - turnAction.turnNumber;

      await clickOption(activePage, 'Roll Dice');
      await activePage.waitForFunction(() => {
        const s = JSON.parse(window.render_game_to_text());
        return Number.isFinite(s.last_roll);
      }, null, { timeout: 7000 });
      await sleep(120);

      const afterRollState = await getTextState(activePage);
      if (!(afterRollState.last_roll >= 2 && afterRollState.last_roll <= 12)) {
        throw new Error(`Invalid roll seen: ${afterRollState.last_roll}`);
      }
      uniqueRolls.add(afterRollState.last_roll);
      turnAction.rolled = true;

      if (summary.cottagesBuilt === 0) {
        for (let i = 0; i < 3 && summary.cottagesBuilt === 0; i += 1) {
          const needs = missingForCottage((await getTextState(activePage))?.me?.resources || {});
          if (needs.length === 0 && (await buildIfPossible(activePage, 'cottage'))) {
            summary.cottagesBuilt += 1;
            turnAction.cottageBuilt = true;
            break;
          }

          if (!(await attemptTrade(activePage, playerPages, activeId, needs))) {
            break;
          }
          summary.playerTradesAccepted += 1;
          turnAction.tradeAccepted = true;

          if (await buildIfPossible(activePage, 'cottage')) {
            summary.cottagesBuilt += 1;
            turnAction.cottageBuilt = true;
            break;
          }
        }
      } else if (await attemptTrade(activePage, playerPages, activeId)) {
        summary.playerTradesAccepted += 1;
        turnAction.tradeAccepted = true;
      }

      if (!turnAction.cottageBuilt && summary.cottagesBuilt === 0) {
        if (await attemptBankTrade(activePage)) {
          summary.bankTradesCompleted += 1;
          turnAction.bankTradeCompleted = true;
        }
        if (await buildIfPossible(activePage, 'cottage')) {
          summary.cottagesBuilt += 1;
          turnAction.cottageBuilt = true;
        }
      } else if (await attemptBankTrade(activePage)) {
        summary.bankTradesCompleted += 1;
        turnAction.bankTradeCompleted = true;
      }

      if ((summary.cottagesBuilt > 0 || (summary.trailsBuilt === 0 && turnsRemainingAfterThis <= 2)) && await buildIfPossible(activePage, 'trail')) {
        summary.trailsBuilt += 1;
        turnAction.trailBuilt = true;
      }

      if (summary.cottagesBuilt > 0 && await attemptBuyDevCard(activePage)) {
        summary.devCardsBought += 1;
        turnAction.devBought = true;
      }

      await clickOption(activePage, 'End Turn');
      await hostPage.waitForFunction(
        ({ prior }) => JSON.parse(window.render_game_to_text()).active_player_id !== prior,
        { prior: activeId },
        { timeout: 7000 }
      );

      summary.turnsCompleted += 1;
      summary.perTurn.push(turnAction);
      await sleep(80);
    }

    summary.uniqueRollCount = uniqueRolls.size;

    const screenshotPath = '/Users/Naitik/Python/Shorewood/output/web-game/four-player-after-6-turns.png';
    await hostPage.screenshot({ path: screenshotPath, fullPage: true });
    summary.screenshotPath = screenshotPath;

    const requirementChecks = {
      sixTurnsCompleted: summary.turnsCompleted === 6,
      builtTrail: summary.trailsBuilt > 0,
      builtCottage: summary.cottagesBuilt > 0,
      playerTradeAccepted: summary.playerTradesAccepted > 0,
      bankTradeCompleted: summary.bankTradesCompleted > 0
    };

    summary.requirementChecks = requirementChecks;
    summary.ok = Object.values(requirementChecks).every(Boolean);

    return summary;
  } finally {
    for (const ctx of contexts) {
      await ctx.close();
    }
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const attempts = [];

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const summary = await runSingleAttempt(browser, attempt);
      attempts.push(summary);
      if (summary.ok) {
        const finalSummary = {
          ok: true,
          successfulAttempt: attempt,
          summary,
          attemptsTried: attempts.length
        };
        fs.writeFileSync('/Users/Naitik/Python/Shorewood/output/web-game/four-player-6turn-retest-summary.json', JSON.stringify(finalSummary, null, 2));
        console.log(JSON.stringify(finalSummary, null, 2));
        return;
      }
    }

    const failedSummary = {
      ok: false,
      message: `No attempt met all requirements after ${MAX_ATTEMPTS} runs`,
      attempts
    };
    fs.writeFileSync('/Users/Naitik/Python/Shorewood/output/web-game/four-player-6turn-retest-summary.json', JSON.stringify(failedSummary, null, 2));
    throw new Error(JSON.stringify(failedSummary, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
