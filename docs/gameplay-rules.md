# Gameplay Rules (Implemented)

This document describes current behavior implemented in `packages/core/src/engine.js` and surfaced in the client.

## Match Basics

- Players: 2 to 4
- Phases: `vote` -> `setup` -> `main` -> `ended`
- Win modes:
  - `first_to_10`
  - `highest_at_60` (tie-breakers: most Manors, then most dev cards remaining, then host chooses)

## Board and Resource Model

Board:
- 19 hexes (radius 2)
- 18 number tokens on producing hexes (Wild Heath has no token/resource)

Terrain distribution:
- Whisperwood (timber): 4
- Clay Pits (clay): 3
- Shepherd's Meadow (wool): 4
- Golden Fields (harvest): 4
- Ironridge (iron): 3
- Wild Heath: 1

Bazaar stalls:
- 9 coastal stalls total
- 5 specific `2:1` stalls (one per resource)
- 4 generic `3:1` stalls
- fallback bank ratio: `4:1`

## Setup Phase (Snake)

Per player order:
1. Place Cottage
2. Place Trail

Then reverse order repeats:
1. Place Cottage
2. Place Trail

Setup constraints:
- Cottage cannot be adjacent to any existing structure.
- Setup Trail must connect to the just-placed setup Cottage.

Setup resources:
- On **each** setup Cottage placement, player gains +1 per adjacent producing hex.
- Wild Heath gives nothing.

## Main Turn Action Model

For active player, the intended main-turn option list is:
1. Roll Dice
2. Build Road
3. Build Cottage
4. Build Manor
5. Buy Development Card
6. Post Trade Offer
7. Trade with Bazaar
8. End Turn

### Legal actions by state

Active player, pre-roll:
- `rollDice`
- `acceptTrade`
- `declineTrade`

Active player, post-roll:
- `buildTrail`
- `buildCottage`
- `upgradeManor`
- `bankTrade`
- `buyDevCard`
- `playDevCard`
- `proposeTrade`
- `acceptTrade`
- `declineTrade`
- `endTurn`

Non-active players:
- `acceptTrade`
- `declineTrade`

UI behavior:
- Options list is shown for current state/player.
- In main phase, non-active players can have an empty options list; this is expected.

## Dice, Production, and Effects

Dice:
- 2d6, valid results 2..12

Production:
- Matching token hexes produce to adjacent structures
- Cottage: +1
- Manor: +2

Frost (on roll 2):
- If roller has no active Hearth Ward, one random occupied producing hex is frosted for that player
- Frost duration: 2 of that player's turns
- Frost blocks that player's production from that hex

Hearth Ward:
- Prevents Frost while `protectionTurns > 0`

Charter Claim:
- Claimed producing hex only yields to claim owner
- Duration: 5 global turns

## Build Actions and Costs

Road/Trail:
- Cost: 1 timber + 1 clay
- Must be on legal connected edge
- Cannot use occupied edge

Cottage:
- Cost: 1 timber + 1 clay + 1 wool + 1 harvest
- Must satisfy distance rule (no adjacent structure)
- In main phase, must connect to own road network

Manor upgrade:
- Cost: 2 harvest + 3 iron
- Must upgrade own Cottage intersection

Piece limits per player:
- Trails: 15
- Cottages: 5
- Manors: 4

## Trading Rules

Player trade offers (`proposeTrade`):
- Active player only
- Post-roll only
- Offer creator must currently hold offered resources
- Supports targeted or open offers

Trade acceptance (`acceptTrade`):
- Offer must still be pending
- Targeting enforced
- Both sides revalidated at accept time
- Atomic resource swap

Bazaar trade (`bankTrade`):
- Active player, post-roll only
- Ratio determined by unlocked stalls
- `giveAmount` must exactly match required ratio

## Development Cards

Buy (`buyDevCard`):
- Cost: 1 wool + 1 harvest + 1 iron
- Active player, post-roll only
- Fails if deck empty

Play (`playDevCard`):
- Active player, post-roll only
- Cannot play card on the same turn it was bought
- `heritage_deed` is passive and cannot be played

Effects:
- `trailblazer`: +2 free trail builds this turn
- `bountiful_basket`: gain exactly 2 chosen resources
- `hearth_ward`: Frost immunity for 2 turns
- `charter_claim`: claim one producing hex for 5 global turns
- `heritage_deed`: passive VP card

## How Shorewood Differs from Classic Catan

- Includes win-condition voting before setup.
- Setup grants resources on both setup Cottage placements.
- Roll of 2 triggers Frost mechanic (instead of robber/7 behavior).
- Uses Bazaar stalls (`2:1` / `3:1`) with coastal unlocks.
- Uses Shorewood-specific development card set and effects.
- No longest road / largest army scoring paths.

## Invalid Action Feedback

Both layers enforce rules:
- Client pre-checks give immediate guidance (missing resources, wrong turn, roll required, no legal targets).
- Server performs authoritative checks and returns explicit `error` reasons.
