import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173';
const RESOURCES = ['timber', 'clay', 'wool', 'harvest', 'iron'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bagTotal(bag) {
  return Object.values(bag || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
}

async function getTextState(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function clickOption(page, labelPart) {
  const option = page.locator('.option-item', { hasText: labelPart }).first();
  await option.waitFor({ state: 'visible', timeout: 9000 });
  await option.click();
}

async function clickHighlightedPlacement(page, type) {
  const selector = type === 'cottage' ? '.intersection.highlight' : '.edge.highlight';
  const attr = type === 'cottage' ? 'data-intersection-id' : 'data-edge-id';

  const id = await page.evaluate(
    ({ localSelector, localAttr }) => {
      const nodes = [...document.querySelectorAll(localSelector)];
      const target = nodes.find((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && (rect.width > 0 || rect.height > 0);
      });
      return target?.getAttribute(localAttr) || null;
    },
    { localSelector: selector, localAttr: attr }
  );

  if (!id) {
    throw new Error(`No highlighted ${type} target available`);
  }

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
  await confirm.waitFor({ state: 'visible', timeout: 6000 });
  await confirm.click({ force: true });
  await sleep(120);
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

async function getErrorToast(page) {
  return page
    .locator('.status-pill.error')
    .first()
    .textContent()
    .then((value) => value?.trim() || null)
    .catch(() => null);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const contexts = [];
  const pages = [];

  try {
    for (let i = 0; i < 4; i += 1) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      pages.push(await ctx.newPage());
    }

    const [hostPage, guest2Page, guest3Page, guest4Page] = pages;

    await hostPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await hostPage.fill('#name-input', 'HostP1');
    await hostPage.click('#save-profile');
    await hostPage.click('#create-room-btn');
    await hostPage.locator('text=Shorewood Lobby').waitFor({ timeout: 10000 });

    const roomId = new URL(hostPage.url()).searchParams.get('room');
    if (!roomId) {
      throw new Error('Failed to get room id from host URL');
    }

    const guestConfigs = [
      { page: guest2Page, name: 'BlueP2' },
      { page: guest3Page, name: 'GreenP3' },
      { page: guest4Page, name: 'RedP4' }
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

    await hostPage.waitForFunction(() => {
      const s = JSON.parse(window.render_game_to_text());
      return s.mode === 'setup';
    }, null, { timeout: 10000 });

    const playerPages = {};
    for (const page of pages) {
      const id = (await getTextState(page)).me?.id;
      if (!id) {
        throw new Error('Player id missing in text state');
      }
      playerPages[id] = page;
    }

    const setupTotals = Object.fromEntries(Object.keys(playerPages).map((id) => [id, 0]));

    for (let i = 0; i < 16; i += 1) {
      const hostState = await getTextState(hostPage);
      if (hostState.mode !== 'setup') {
        break;
      }

      const step = hostState.setup_step;
      if (!step || !playerPages[step.playerId]) {
        throw new Error(`Invalid setup step at index ${i}`);
      }

      const actorPage = playerPages[step.playerId];
      await ensureStepOnPage(actorPage, step);

      if (step.type === 'cottage') {
        const beforeTotal = bagTotal((await getTextState(actorPage)).me?.resources);
        await clickHighlightedPlacement(actorPage, 'cottage');
        await waitStepAdvance(hostPage, step);
        const afterTotal = bagTotal((await getTextState(actorPage)).me?.resources);
        const gain = afterTotal - beforeTotal;
        if (gain < 0 || gain > 3) {
          throw new Error(`Invalid setup resource gain ${gain} for ${step.playerId}`);
        }
        setupTotals[step.playerId] += gain;
      } else {
        await clickHighlightedPlacement(actorPage, 'trail');
        await waitStepAdvance(hostPage, step);
      }
    }

    const postSetup = await getTextState(hostPage);
    if (postSetup.mode !== 'main') {
      throw new Error('Game did not reach main phase after 4-player setup');
    }

    for (const [playerId, total] of Object.entries(setupTotals)) {
      if (total > 6) {
        throw new Error(`Setup resources exceed 6 for ${playerId}: ${total}`);
      }
    }

    const turnCounts = Object.fromEntries(Object.keys(playerPages).map((id) => [id, 0]));
    const uniqueRolls = new Set();
    const trailsBuiltByPlayer = Object.fromEntries(Object.keys(playerPages).map((id) => [id, 0]));
    const preRollEndTurnRuleChecks = [];

    let guard = 0;
    while (Object.values(turnCounts).some((count) => count < 3) && guard < 80) {
      guard += 1;
      const hostState = await getTextState(hostPage);
      if (hostState.mode !== 'main') {
        throw new Error(`Game left main phase unexpectedly: ${hostState.mode}`);
      }

      const activeId = hostState.active_player_id;
      const activePage = playerPages[activeId];
      if (!activePage) {
        throw new Error(`No active page mapping for ${activeId}`);
      }

      if (turnCounts[activeId] >= 3) {
        await clickOption(activePage, 'Roll 2d6');
        await sleep(100);
        await clickOption(activePage, 'End Turn');
        await hostPage.waitForFunction(
          ({ prior }) => JSON.parse(window.render_game_to_text()).active_player_id !== prior,
          { prior: activeId },
          { timeout: 7000 }
        );
        continue;
      }

      const preRoll = await getTextState(activePage);
      if (!preRoll.legal_actions.includes('rollDice')) {
        throw new Error(`rollDice missing from legal actions for ${activeId} before roll`);
      }

      if (turnCounts[activeId] === 0) {
        await clickOption(activePage, 'End Turn');
        await sleep(120);
        const toast = await getErrorToast(activePage);
        preRollEndTurnRuleChecks.push(Boolean(toast && /roll/i.test(toast)));
      }

      await clickOption(activePage, 'Roll 2d6');
      await activePage.waitForFunction(() => {
        const s = JSON.parse(window.render_game_to_text());
        return Number.isFinite(s.last_roll);
      }, null, { timeout: 7000 });

      const afterRoll = await getTextState(activePage);
      const roll = afterRoll.last_roll;
      if (!(Number.isFinite(roll) && roll >= 2 && roll <= 12)) {
        throw new Error(`Invalid roll: ${roll}`);
      }
      uniqueRolls.add(roll);

      if (!afterRoll.legal_actions.includes('endTurn')) {
        throw new Error(`endTurn missing from legal actions after roll for ${activeId}`);
      }

      const canAffordTrail = (afterRoll.me?.resources?.timber || 0) >= 1 && (afterRoll.me?.resources?.clay || 0) >= 1;
      if (canAffordTrail) {
        const beforeResources = { ...(afterRoll.me?.resources || {}) };
        const highlightCount = await activePage.locator('.edge.highlight').count();
        if (highlightCount > 0) {
          await clickHighlightedPlacement(activePage, 'trail');
          const afterBuild = await getTextState(activePage);
          const timberDiff = (afterBuild.me?.resources?.timber || 0) - (beforeResources.timber || 0);
          const clayDiff = (afterBuild.me?.resources?.clay || 0) - (beforeResources.clay || 0);
          if (!(timberDiff <= -1 && clayDiff <= -1)) {
            throw new Error(`Trail build did not consume expected resources for ${activeId}`);
          }
          trailsBuiltByPlayer[activeId] += 1;
        }
      }

      await clickOption(activePage, 'End Turn');
      await hostPage.waitForFunction(
        ({ prior }) => JSON.parse(window.render_game_to_text()).active_player_id !== prior,
        { prior: activeId },
        { timeout: 7000 }
      );

      turnCounts[activeId] += 1;
      await sleep(70);
    }

    if (Object.values(turnCounts).some((count) => count < 3)) {
      throw new Error(`Did not complete 3 turns for each player: ${JSON.stringify(turnCounts)}`);
    }

    if (!preRollEndTurnRuleChecks.every(Boolean)) {
      throw new Error('Pre-roll end-turn rejection rule check failed for one or more players');
    }

    const anyTrailBuilt = Object.values(trailsBuiltByPlayer).some((count) => count > 0);
    if (!anyTrailBuilt) {
      throw new Error('No trails were built during 12-turn simulation despite build attempts');
    }

    const screenshotPath = '/Users/Naitik/Python/Shorewood/output/web-game/four-player-after-3-turns.png';
    await hostPage.screenshot({ path: screenshotPath, fullPage: true });

    const summary = {
      ok: true,
      roomId,
      turnsPerPlayer: turnCounts,
      setupResourcesPerPlayer: setupTotals,
      uniqueRollCount: uniqueRolls.size,
      trailsBuiltByPlayer,
      screenshotPath
    };

    fs.writeFileSync('/Users/Naitik/Python/Shorewood/output/web-game/four-player-pass-summary.json', JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    for (const ctx of contexts) {
      await ctx.close();
    }
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
