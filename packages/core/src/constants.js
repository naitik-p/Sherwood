export const RESOURCES = ["timber", "clay", "wool", "harvest", "iron"];

export const RESOURCE_LABELS = {
  timber: "Timber",
  clay: "Clay",
  wool: "Wool",
  harvest: "Harvest",
  iron: "Iron"
};

export const TERRAINS = {
  whisperwood: { name: "Whisperwood", resource: "timber" },
  clay_pits: { name: "Clay Pits", resource: "clay" },
  shepherds_meadow: { name: "Shepherd's Meadow", resource: "wool" },
  golden_fields: { name: "Golden Fields", resource: "harvest" },
  ironridge: { name: "Ironridge", resource: "iron" },
  wild_heath: { name: "Wild Heath", resource: null }
};

export const DEFAULT_TERRAIN_DISTRIBUTION = {
  whisperwood: 4,
  clay_pits: 3,
  shepherds_meadow: 4,
  golden_fields: 4,
  ironridge: 3,
  wild_heath: 1
};

export const DEFAULT_NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

export const BUILD_COSTS = {
  trail: { timber: 1, clay: 1 },
  cottage: { timber: 1, clay: 1, wool: 1, harvest: 1 },
  manor: { harvest: 2, iron: 3 },
  dev_card: { wool: 1, harvest: 1, iron: 1 }
};

export const PIECE_LIMITS = {
  trails: 15,
  cottages: 5,
  manors: 4
};

export const DEV_CARD_COUNTS = {
  trailblazer: 6,
  bountiful_basket: 6,
  hearth_ward: 5,
  heritage_deed: 5,
  charter_claim: 2
};

export const DEV_CARD_LABELS = {
  trailblazer: "Trailblazer",
  bountiful_basket: "Bountiful Basket",
  hearth_ward: "Hearth Ward",
  heritage_deed: "Heritage Deed",
  charter_claim: "Charter Claim"
};

export const WIN_MODES = {
  FIRST_TO_10: "first_to_10",
  HIGHEST_AT_60: "highest_at_60"
};

export const VOTE_MODES = [WIN_MODES.FIRST_TO_10, WIN_MODES.HIGHEST_AT_60];

export const BAZAAR_STALLS = [
  { kind: "specific", resource: "timber", ratio: 2 },
  { kind: "specific", resource: "clay", ratio: 2 },
  { kind: "specific", resource: "wool", ratio: 2 },
  { kind: "specific", resource: "harvest", ratio: 2 },
  { kind: "specific", resource: "iron", ratio: 2 },
  { kind: "generic", resource: null, ratio: 3 },
  { kind: "generic", resource: null, ratio: 3 },
  { kind: "generic", resource: null, ratio: 3 },
  { kind: "generic", resource: null, ratio: 3 }
];

export const COLORS = {
  frost: "#dce9f7",
  charter: "#f4e7b0"
};

export const DEFAULT_CONFIG = {
  buildCosts: BUILD_COSTS,
  pieceLimits: PIECE_LIMITS,
  devCardCounts: DEV_CARD_COUNTS,
  voteDurationMs: 30_000,
  roomTtlHours: 24,
  timedWinMinutes: 60,
  timedWinCheckIntervalMs: 1_000,
  noAdjacentHotTokens: true,
  avoidHotClusters: true
};
