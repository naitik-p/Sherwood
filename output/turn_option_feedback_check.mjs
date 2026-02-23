import fs from "node:fs";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:5173";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTextState(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function clickOption(page, labelPart) {
  const option = page.locator(".option-item", { hasText: labelPart }).first();
  await option.waitFor({ state: "visible", timeout: 9000 });
  await option.click();
}

async function getErrorToast(page) {
  return page
    .locator(".status-pill.error")
    .first()
    .textContent()
    .then((value) => value?.trim() || null)
    .catch(() => null);
}

async function clickHighlightedPlacement(page, type) {
  const selector = type === "cottage" ? ".intersection.highlight" : ".edge.highlight";
  const attr = type === "cottage" ? "data-intersection-id" : "data-edge-id";

  const id = await page.evaluate(
    ({ localSelector, localAttr }) => {
      const nodes = [...document.querySelectorAll(localSelector)];
      const target = nodes.find((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && (rect.width > 0 || rect.height > 0);
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
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    },
    { localAttr: attr, localId: id }
  );

  const confirm = page.locator("#confirm-placement");
  await confirm.waitFor({ state: "visible", timeout: 6000 });
  await confirm.click({ force: true });
  await sleep(120);
}

async function ensureStepOnPage(page, step) {
  await page.waitForFunction(
    ({ playerId, type, round }) => {
      const payload = JSON.parse(window.render_game_to_text());
      return (
        payload.mode === "setup" &&
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
      if (payload.mode !== "setup") {
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

async function completeTwoPlayerSetup(hostPage, playerPages) {
  for (let i = 0; i < 8; i += 1) {
    const hostState = await getTextState(hostPage);
    if (hostState.mode !== "setup") {
      break;
    }

    const step = hostState.setup_step;
    const actorPage = playerPages[step.playerId];
    if (!actorPage) {
      throw new Error(`Missing actor page for ${step.playerId}`);
    }

    await ensureStepOnPage(actorPage, step);
    await clickHighlightedPlacement(actorPage, step.type);
    await waitStepAdvance(hostPage, step);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  try {
    await hostPage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await hostPage.fill("#name-input", "HostP1");
    await hostPage.click("#save-profile");
    await hostPage.click("#create-room-btn");
    await hostPage.locator("text=Shorewood Lobby").waitFor({ timeout: 10000 });

    const roomId = new URL(hostPage.url()).searchParams.get("room");
    if (!roomId) {
      throw new Error("Failed to get room id from host URL");
    }

    await guestPage.goto(`${BASE_URL}/?room=${roomId}`, { waitUntil: "domcontentloaded" });
    await guestPage.fill("#name-input", "GuestP2");
    await guestPage.click("#save-profile");
    await guestPage.click("#join-room-btn");

    await hostPage.locator("[data-admit]").first().waitFor({ state: "visible", timeout: 10000 });
    await hostPage.locator("[data-admit]").first().click();

    await hostPage.locator("#toggle-ready").waitFor({ state: "visible", timeout: 10000 });
    await guestPage.locator("#toggle-ready").waitFor({ state: "visible", timeout: 10000 });
    await hostPage.click("#toggle-ready");
    await guestPage.click("#toggle-ready");

    await hostPage.click("#start-match");
    await clickOption(hostPage, "Vote: First to 10 points");
    await clickOption(guestPage, "Vote: First to 10 points");

    await hostPage.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "setup", null, { timeout: 10000 });

    const hostId = (await getTextState(hostPage)).me?.id;
    const guestId = (await getTextState(guestPage)).me?.id;
    if (!hostId || !guestId) {
      throw new Error("Missing player ids in text state");
    }

    const playerPages = { [hostId]: hostPage, [guestId]: guestPage };
    await completeTwoPlayerSetup(hostPage, playerPages);

    const postSetup = await getTextState(hostPage);
    if (postSetup.mode !== "main") {
      throw new Error("Game did not reach main phase");
    }

    const activePage = playerPages[postSetup.active_player_id];
    if (!activePage) {
      throw new Error("Active player page not found");
    }

    const optionLabels = await activePage.evaluate(() =>
      [...document.querySelectorAll(".option-item")].map((entry) => entry.textContent?.replace(/\s+/g, " ").trim())
    );

    const expectedLabels = [
      "Roll Dice",
      "Build Road",
      "Build Cottage",
      "Build Manor",
      "Buy Development Card",
      "Post Trade Offer",
      "Trade with Bazaar",
      "End Turn"
    ];
    for (const label of expectedLabels) {
      if (!optionLabels.some((entry) => entry?.includes(label))) {
        throw new Error(`Missing turn option: ${label}`);
      }
    }
    await activePage.screenshot({
      path: "/Users/Naitik/Python/Shorewood/output/web-game/turn-option-visible-active-turn.png",
      fullPage: true
    });

    await clickOption(activePage, "Build Manor");
    await sleep(140);
    const preRollManorError = await getErrorToast(activePage);

    await clickOption(activePage, "Buy Development Card");
    await sleep(140);
    const preRollDevError = await getErrorToast(activePage);

    await clickOption(activePage, "Roll Dice");
    await activePage.waitForFunction(() => Number.isFinite(JSON.parse(window.render_game_to_text()).last_roll), null, { timeout: 7000 });
    await sleep(5300);

    await clickOption(activePage, "Build Manor");
    await sleep(140);
    const postRollManorError = await getErrorToast(activePage);

    const canAffordDev = (payload) => {
      const resources = payload?.me?.resources || {};
      return (resources.wool || 0) >= 1 && (resources.harvest || 0) >= 1 && (resources.iron || 0) >= 1;
    };

    let stateAfterRoll = await getTextState(activePage);
    let buyAttempts = 0;
    while (canAffordDev(stateAfterRoll) && buyAttempts < 8) {
      await clickOption(activePage, "Buy Development Card");
      buyAttempts += 1;
      await sleep(200);
      stateAfterRoll = await getTextState(activePage);
    }

    await clickOption(activePage, "Buy Development Card");
    await sleep(160);
    const postRollDevError = await getErrorToast(activePage);

    await activePage.fill("#trade-give-amount", "99");
    await clickOption(activePage, "Post Trade Offer");
    await sleep(140);
    const postTradeError = await getErrorToast(activePage);

    await clickOption(activePage, "End Turn");
    await hostPage.waitForFunction(
      ({ prior }) => JSON.parse(window.render_game_to_text()).active_player_id !== prior,
      { prior: postSetup.active_player_id },
      { timeout: 7000 }
    );

    const summary = {
      ok: true,
      roomId,
      optionLabels,
      checks: {
        preRollManorBlocked: Boolean(preRollManorError && /roll/i.test(preRollManorError)),
        preRollDevBlocked: Boolean(preRollDevError && /roll/i.test(preRollDevError)),
        postRollManorBlockedByRules: Boolean(postRollManorError && /not enough resources|no legal manor/i.test(postRollManorError)),
        postRollDevBlockedByResources: Boolean(postRollDevError && /not enough resources|development deck is empty/i.test(postRollDevError)),
        invalidTradeBlocked: Boolean(postTradeError && /do not have enough|not enough/i.test(postTradeError))
      },
      errors: {
        preRollManorError,
        preRollDevError,
        postRollManorError,
        postRollDevError,
        postTradeError
      },
      meta: {
        buyAttempts
      }
    };

    fs.writeFileSync("/Users/Naitik/Python/Shorewood/output/web-game/turn-option-feedback-summary.json", JSON.stringify(summary, null, 2));
    await hostPage.screenshot({ path: "/Users/Naitik/Python/Shorewood/output/web-game/turn-option-feedback.png", fullPage: true });
    await activePage.screenshot({ path: "/Users/Naitik/Python/Shorewood/output/web-game/turn-option-feedback-active-player.png", fullPage: true });

    if (!Object.values(summary.checks).every(Boolean)) {
      throw new Error(`Feedback checks failed: ${JSON.stringify(summary.checks)}`);
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await hostCtx.close();
    await guestCtx.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
