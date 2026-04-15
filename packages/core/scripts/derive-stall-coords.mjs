import { createBoard } from "../src/board.js";

const board = createBoard({ hexSize: 84 });
const coastal = board.intersections.filter((n) => n.hexIds.length < 3);

// Compute center of mass for coastal nodes
const cx = coastal.reduce((sum, n) => sum + n.x, 0) / coastal.length;
const cy = coastal.reduce((sum, n) => sum + n.y, 0) / coastal.length;

// Compute angle for each coastal node relative to center
// Normalize so that topmost node (min y) is at 0 index, then sort clockwise
// clockwise from top: sort by ((angle + Math.PI/2 + 2*Math.PI) % (2*Math.PI)) ascending
const withAngle = coastal.map((n) => {
  const angle = Math.atan2(n.y - cy, n.x - cx);
  const normalized = ((angle + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI));
  return { node: n, normalized };
});

withAngle.sort((a, b) => a.normalized - b.normalized);

const sorted = withAngle.map((item) => item.node);

// Select 9 evenly spaced positions by index
// for i in 0..8, pick sorted[Math.round(i * 30 / 9) % 30]
const selected = [];
for (let i = 0; i < 9; i++) {
  const idx = Math.round(i * 30 / 9) % 30;
  selected.push(sorted[idx]);
}

// Port order (clockwise from top): wool, generic, timber, generic, harvest, iron, generic, clay, generic
const portLabels = [
  "0 wool (2:1)",
  "1 generic (3:1)",
  "2 timber (2:1)",
  "3 generic (3:1)",
  "4 harvest (2:1)",
  "5 iron (2:1)",
  "6 generic (3:1)",
  "7 clay (2:1)",
  "8 generic (3:1)"
];

// Round to 3 decimal places matching coordKey
function r3(v) {
  return Math.round(v * 1000) / 1000;
}

console.log("export const FIXED_STALL_COORDS = [");
for (let i = 0; i < 9; i++) {
  const n = selected[i];
  const x = r3(n.x);
  const y = r3(n.y);
  const comma = i < 8 ? "," : "";
  console.log(`  [${x}, ${y}]${comma} // ${portLabels[i]}`);
}
console.log("];");
console.log("");
console.log("// coastal check:");
for (let i = 0; i < 9; i++) {
  const n = selected[i];
  console.log(`// index ${i}: coastal === ${n.hexIds.length < 3} (hexIds.length=${n.hexIds.length})`);
}
