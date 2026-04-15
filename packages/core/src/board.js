import {
  BAZAAR_STALLS_ORDERED,
  DEFAULT_NUMBER_TOKENS,
  DEFAULT_TERRAIN_DISTRIBUTION,
  FIXED_STALL_COORDS,
  TERRAINS
} from "./constants.js";
import { assert, randomInt, shuffle } from "./utils.js";

const SQRT3 = Math.sqrt(3);
const HEX_DIRECTIONS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
];

function axialToPixel(q, r, size) {
  return {
    x: size * SQRT3 * (q + r / 2),
    y: size * (3 / 2) * r
  };
}

function cornerPoint(centerX, centerY, size, i) {
  const angleDeg = 60 * i - 30;
  const angleRad = (Math.PI / 180) * angleDeg;
  return {
    x: centerX + size * Math.cos(angleRad),
    y: centerY + size * Math.sin(angleRad)
  };
}

function coordKey(x, y) {
  return `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;
}

function makeTerrainPool(distribution) {
  const terrains = [];
  for (const [terrainId, count] of Object.entries(distribution)) {
    for (let i = 0; i < count; i += 1) {
      terrains.push(terrainId);
    }
  }
  return terrains;
}

function buildAxialHexes(radius = 2) {
  const hexes = [];
  for (let q = -radius; q <= radius; q += 1) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r += 1) {
      hexes.push({ q, r });
    }
  }
  return hexes;
}

function buildHexAdjacency(hexes) {
  const byCoord = new Map();
  for (const hex of hexes) {
    byCoord.set(`${hex.q},${hex.r}`, hex.id);
  }

  const adjacency = new Map();
  for (const hex of hexes) {
    const neighbors = [];
    for (const [dq, dr] of HEX_DIRECTIONS) {
      const neighborId = byCoord.get(`${hex.q + dq},${hex.r + dr}`);
      if (neighborId) {
        neighbors.push(neighborId);
      }
    }
    adjacency.set(hex.id, neighbors);
  }

  return adjacency;
}

function scoreTokenLayout(hexes, adjacency) {
  const hot = new Set([6, 8]);
  let score = 0;

  for (const hex of hexes) {
    if (!hot.has(hex.token)) {
      continue;
    }

    const neighbors = adjacency.get(hex.id) ?? [];
    for (const neighborId of neighbors) {
      if (neighborId <= hex.id) {
        continue;
      }
      const other = hexes.find((h) => h.id === neighborId);
      if (!other || !hot.has(other.token)) {
        continue;
      }

      if (hex.token === other.token) {
        score += 100;
      } else {
        score += 20;
      }
    }
  }

  return score;
}

function assignTokensWithGuardrails(hexes, rng) {
  const producing = hexes.filter((hex) => hex.terrainId !== "wild_heath");
  const adjacency = buildHexAdjacency(hexes);
  let best = null;

  for (let attempt = 0; attempt < 400; attempt += 1) {
    const tokens = shuffle(DEFAULT_NUMBER_TOKENS, rng);
    const order = shuffle(producing, rng);

    for (let i = 0; i < order.length; i += 1) {
      order[i].token = tokens[i];
    }

    const score = scoreTokenLayout(producing, adjacency);
    if (!best || score < best.score) {
      best = {
        score,
        layout: producing.map((hex) => ({ id: hex.id, token: hex.token }))
      };
    }

    if (score === 0) {
      break;
    }
  }

  assert(best, "Failed to assign token layout");

  const tokensByHex = new Map(best.layout.map((entry) => [entry.id, entry.token]));
  for (const hex of hexes) {
    hex.token = hex.terrainId === "wild_heath" ? null : tokensByHex.get(hex.id);
  }
}

function chooseStallIntersections(intersections) {
  const byCoord = new Map(
    intersections.map((node) => [coordKey(node.x, node.y), node])
  );
  return FIXED_STALL_COORDS.map(([x, y]) => {
    const key = coordKey(x, y);
    const node = byCoord.get(key);
    assert(node, `Fixed stall coord ${x},${y} not found in intersection list`);
    assert(node.coastal, `Fixed stall coord ${x},${y} is not coastal`);
    return node;
  });
}

export function createBoard({ rng = Math.random, hexSize = 84 } = {}) {
  const axialHexes = buildAxialHexes(2);
  const terrainPool = shuffle(makeTerrainPool(DEFAULT_TERRAIN_DISTRIBUTION), rng);

  assert(axialHexes.length === 19, "Board must contain 19 hexes");
  assert(terrainPool.length === 19, "Terrain pool must match board hex count");

  const hexes = axialHexes.map((hex, idx) => {
    const center = axialToPixel(hex.q, hex.r, hexSize);
    return {
      id: `hex_${idx + 1}`,
      q: hex.q,
      r: hex.r,
      x: center.x,
      y: center.y,
      terrainId: terrainPool[idx],
      terrainName: TERRAINS[terrainPool[idx]].name,
      resource: TERRAINS[terrainPool[idx]].resource,
      token: null,
      intersectionIds: [],
      edgeIds: []
    };
  });

  assignTokensWithGuardrails(hexes, rng);

  const intersections = [];
  const edges = [];
  const intersectionByCoord = new Map();
  const edgeByKey = new Map();

  for (const hex of hexes) {
    const cornerIds = [];
    for (let i = 0; i < 6; i += 1) {
      const pt = cornerPoint(hex.x, hex.y, hexSize, i);
      const key = coordKey(pt.x, pt.y);
      let node = intersectionByCoord.get(key);

      if (!node) {
        node = {
          id: `ix_${intersections.length + 1}`,
          x: Math.round(pt.x * 1000) / 1000,
          y: Math.round(pt.y * 1000) / 1000,
          hexIds: [],
          edgeIds: [],
          adjacentIntersectionIds: [],
          coastal: false,
          stall: null
        };
        intersections.push(node);
        intersectionByCoord.set(key, node);
      }

      if (!node.hexIds.includes(hex.id)) {
        node.hexIds.push(hex.id);
      }
      cornerIds.push(node.id);
    }

    hex.intersectionIds = cornerIds;

    for (let i = 0; i < 6; i += 1) {
      const a = cornerIds[i];
      const b = cornerIds[(i + 1) % 6];
      const key = [a, b].sort().join("-");
      let edge = edgeByKey.get(key);

      if (!edge) {
        edge = {
          id: `ed_${edges.length + 1}`,
          a,
          b,
          hexIds: [],
          coastal: false
        };
        edges.push(edge);
        edgeByKey.set(key, edge);
      }

      if (!edge.hexIds.includes(hex.id)) {
        edge.hexIds.push(hex.id);
      }
      hex.edgeIds.push(edge.id);
    }
  }

  const nodeById = new Map(intersections.map((node) => [node.id, node]));

  for (const edge of edges) {
    const aNode = nodeById.get(edge.a);
    const bNode = nodeById.get(edge.b);
    aNode.edgeIds.push(edge.id);
    bNode.edgeIds.push(edge.id);

    if (!aNode.adjacentIntersectionIds.includes(bNode.id)) {
      aNode.adjacentIntersectionIds.push(bNode.id);
    }
    if (!bNode.adjacentIntersectionIds.includes(aNode.id)) {
      bNode.adjacentIntersectionIds.push(aNode.id);
    }

    edge.coastal = edge.hexIds.length === 1;
  }

  for (const node of intersections) {
    node.coastal = node.hexIds.length < 3;
  }

  const stallNodes = chooseStallIntersections(intersections);
  for (let i = 0; i < 9; i += 1) {
    stallNodes[i].stall = {
      id: `stall_${i + 1}`,
      ...BAZAAR_STALLS_ORDERED[i]
    };
  }

  return {
    radius: 2,
    hexSize,
    hexes,
    intersections,
    edges
  };
}

export function getIntersection(board, intersectionId) {
  return board.intersections.find((node) => node.id === intersectionId);
}

export function getEdge(board, edgeId) {
  return board.edges.find((edge) => edge.id === edgeId);
}

export function getHex(board, hexId) {
  return board.hexes.find((hex) => hex.id === hexId);
}

export function boardSummary(board) {
  return {
    hexes: board.hexes.length,
    intersections: board.intersections.length,
    edges: board.edges.length,
    stalls: board.intersections.filter((node) => Boolean(node.stall)).length
  };
}
