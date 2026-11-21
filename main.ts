// Sokoban solver: push-optimal A* per room, stitched into one move string.
//
// Levels are a hallway with independent rooms off it (a box pushed out of a
// room can never come back, so each room's boxes stay on that room's goals).
// Each room is solved on its own with A* over pushes, which is optimal when
// the heuristic never overestimates: here the minimum assignment of boxes to
// goals by wall-only walking distance, one push moving one box one square.
// Rooms are then stitched by walking the player between them. Pure and
// deterministic: budgets are counted in expanded states, never in wall time,
// so two runs write identical bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// One search may expand at most this many states per room before giving up.
const MAX_EXPANSIONS_PER_ROOM = 1_000_000;

type Dir = { dx: number; dy: number; step: string; push: string };
const DIRS: Dir[] = [
  { dx: 0, dy: -1, step: 'u', push: 'U' },
  { dx: 0, dy: 1, step: 'd', push: 'D' },
  { dx: -1, dy: 0, step: 'l', push: 'L' },
  { dx: 1, dy: 0, step: 'r', push: 'R' },
];

type Board = {
  w: number;
  h: number;
  wall: Uint8Array; // 1 = wall
  goals: number[];
  boxes: number[]; // sorted
  player: number;
};

function parseLevel(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

// Squares a box can ever stand on and still reach a goal: pull the goals
// backwards over open floor. A box off a live square is dead, prune it.
function liveSquares(b: Board): Uint8Array {
  const live = new Uint8Array(b.w * b.h);
  const queue = [...b.goals];
  for (const g of b.goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const cell = queue[qi];
    for (const d of DIRS) {
      const step = d.dy * b.w + d.dx;
      const from = cell - step; // square the box is pulled from
      const behind = from - step; // square the player stands on to pull
      if (!b.wall[from] && !b.wall[behind] && !live[from]) {
        live[from] = 1;
        queue.push(from);
      }
    }
  }
  return live;
}

// All squares the player reaches from `from` with `occupied` in the way.
// Returns the reached set as a stamp array plus its lowest square, which
// names the region: two player positions in one region are one state.
function flood(
  b: Board,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
): { low: number } {
  const stack = [from];
  seen[from] = stamp;
  let low = from;
  while (stack.length > 0) {
    const p = stack.pop() as number;
    if (p < low) low = p;
    for (const d of DIRS) {
      const q = p + d.dy * b.w + d.dx;
      if (!b.wall[q] && !occupied[q] && seen[q] !== stamp) {
        seen[q] = stamp;
        stack.push(q);
      }
    }
  }
  return { low };
}

// A 2x2 block of walls/boxes holding a box off its goal can never move.
function frozenBlock(b: Board, occupied: Uint8Array, isGoal: Uint8Array, t: number): boolean {
  const w = b.w;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const cells = [a, a + 1, a + w, a + w + 1];
    let full = true;
    for (const c of cells) if (!b.wall[c] && !occupied[c]) { full = false; break; }
    if (!full) continue;
    for (const c of cells) if (occupied[c] && !isGoal[c]) return true;
  }
  return false;
}

// Shortest walk from `from` to `to` around walls and boxes (lowercase LURD).
function walkTo(b: Board, occupied: Uint8Array, from: number, to: number): string | null {
  if (from === to) return '';
  const prev = new Int32Array(b.w * b.h).fill(-1);
  const how: string[] = new Array(b.w * b.h);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (const d of DIRS) {
      const q = p + d.dy * b.w + d.dx;
      if (b.wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = d.step;
      queue.push(q);
    }
  }
  if (prev[to] === -1) return null;
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

// Minimum-cost assignment of boxes to goals by wall-only distance.
// Brute-force permutations: at most 4 boxes per room here, 24 permutations.
function assignmentHeuristic(
  boxes: number[],
  goals: number[],
  dist: Int32Array, // dist[goalIndex * size + cell]
  size: number,
): number {
  const n = boxes.length;
  const order = goals.map((_, i) => i);
  let best = Infinity;
  const permute = (k: number, acc: number): void => {
    if (acc >= best) return;
    if (k === n) { best = acc; return; }
    for (let i = k; i < n; i++) {
      [order[k], order[i]] = [order[i], order[k]];
      const d = dist[order[k] * size + boxes[k]];
      if (d >= 0) permute(k + 1, acc + d);
      [order[k], order[i]] = [order[i], order[k]];
    }
  };
  permute(0, 0);
  return best;
}

type SearchNode = {
  boxes: number[];
  player: number; // square the player stands on
  parent: number; // index of parent node, -1 for root
  pushBox: number; // box square before the push that made this node, -1 root
  pushDir: number; // index into DIRS, -1 root
  g: number; // pushes so far
  h: number; // assignment heuristic at this node, cached at creation
};

// Push-optimal search for one (sub)level. A* with the assignment heuristic by
// default; with `useHeuristic` false it degrades to plain breadth-first search
// over pushes (h = 0), which is slower but explores in a different order and
// can rescue a room where A* exhausts its state budget. Returns the move
// string or null.
function solveAStar(sub: Board, useHeuristic = true): string | null {
  const size = sub.w * sub.h;
  const isGoal = new Uint8Array(size);
  for (const g of sub.goals) isGoal[g] = 1;
  const live = liveSquares(sub);
  if (sub.boxes.some((b) => !live[b])) return null;

  // Wall-only distances from every goal, for the assignment heuristic.
  const dist = new Int32Array(sub.goals.length * size).fill(-1);
  for (let gi = 0; gi < sub.goals.length; gi++) {
    const queue = [sub.goals[gi]];
    dist[gi * size + sub.goals[gi]] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi];
      for (const d of DIRS) {
        const q = p + d.dy * sub.w + d.dx;
        if (!sub.wall[q] && dist[gi * size + q] < 0) {
          dist[gi * size + q] = dist[gi * size + p] + 1;
          queue.push(q);
        }
      }
    }
  }

  const heuristic = (boxes: number[]): number =>
    useHeuristic ? assignmentHeuristic(boxes, sub.goals, dist, size) : 0;
  const solved = (boxes: number[]): boolean => boxes.every((b) => isGoal[b]);
  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  let stamp = 0;
  // A second mark array: the successor region's flood must not wipe the
  // marks of the current region, which the push loop still reads.
  const seenNext = new Int32Array(size);
  let stampNext = 0;

  // Binary heap of node indexes, ordered by (g + h, h). The heuristic is
  // cached on each node at creation: recomputing it on every comparison
  // dominated the runtime on the larger rooms.
  const heap: number[] = [];
  const heapLess = (a: number, b: number): boolean => {
    const sa = nodes[a].g + nodes[a].h;
    const sb = nodes[b].g + nodes[b].h;
    if (sa !== sb) return sa < sb;
    return nodes[a].h < nodes[b].h;
  };
  const heapPush = (idx: number): void => {
    heap.push(idx);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const heapPop = (): number => {
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heapLess(heap[l], heap[m])) m = l;
        if (r < heap.length && heapLess(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };

  const keyOf = (boxes: number[], low: number): string => `${low}|${boxes.join(',')}`;
  const nodes: SearchNode[] = [
    { boxes: sub.boxes, player: sub.player, parent: -1, pushBox: -1, pushDir: -1, g: 0, h: heuristic(sub.boxes) },
  ];
  const best = new Map<string, number>(); // state key -> best g seen
  for (const b of sub.boxes) occupied[b] = 1;
  const rootLow = flood(sub, occupied, sub.player, seen, ++stamp).low;
  for (const b of sub.boxes) occupied[b] = 0;
  best.set(keyOf(sub.boxes, rootLow), 0);
  heapPush(0);

  let expansions = 0;
  let found = -1;
  while (heap.length > 0) {
    const idx = heapPop();
    const node = nodes[idx];
    if (solved(node.boxes)) { found = idx; break; }
    if (expansions >= MAX_EXPANSIONS_PER_ROOM) return null;
    expansions++;
    for (const b of node.boxes) occupied[b] = 1;
    const regionStamp = ++stamp;
    flood(sub, occupied, node.player, seen, regionStamp);
    for (let bi = 0; bi < node.boxes.length; bi++) {
      const box = node.boxes[bi];
      for (let di = 0; di < DIRS.length; di++) {
        const d = DIRS[di];
        const step = d.dy * sub.w + d.dx;
        const behind = box - step;
        const target = box + step;
        if (seen[behind] !== regionStamp) continue; // player cannot reach the push square
        if (sub.wall[target] || occupied[target] || !live[target]) continue;
        occupied[box] = 0;
        occupied[target] = 1;
        const frozen = frozenBlock(sub, occupied, isGoal, target);
        let key = '';
        let nextBoxes: number[] = [];
        if (!frozen) {
          nextBoxes = node.boxes.slice();
          nextBoxes[bi] = target;
          nextBoxes.sort((a, b2) => a - b2);
          const low = flood(sub, occupied, box, seenNext, ++stampNext).low;
          key = keyOf(nextBoxes, low);
        }
        occupied[target] = 0;
        occupied[box] = 1;
        if (frozen) continue;
        const prevG = best.get(key);
        if (prevG !== undefined && prevG <= node.g + 1) continue;
        best.set(key, node.g + 1);
        nodes.push({ boxes: nextBoxes, player: box, parent: idx, pushBox: box, pushDir: di, g: node.g + 1, h: heuristic(nextBoxes) });
        heapPush(nodes.length - 1);
      }
    }
    for (const b of node.boxes) occupied[b] = 0;
  }
  if (found < 0) return null;

  // Rebuild the push sequence, then expand each push into walk + push.
  const chain: SearchNode[] = [];
  for (let s = found; nodes[s].parent >= 0; s = nodes[s].parent) chain.push(nodes[s]);
  chain.reverse();
  let moves = '';
  let player = sub.player;
  let boxes = sub.boxes;
  for (const step of chain) {
    const d = DIRS[step.pushDir];
    const delta = d.dy * sub.w + d.dx;
    const from = step.pushBox;
    for (const b of boxes) occupied[b] = 1;
    const walk = walkTo(sub, occupied, player, from - delta);
    for (const b of boxes) occupied[b] = 0;
    if (walk === null) return null;
    moves += walk + d.push;
    player = from;
    boxes = step.boxes;
  }
  return moves;
}

type Room = { squares: number[]; boxes: number[]; goals: number[] };

// Split a level into rooms: cut the hallway's dead squares (a box there can
// never reach a goal) out of the floor; each remaining component holding a
// box is a room. Null when the level is no set of rooms.
function roomsOf(level: Board): Room[] | null {
  const live = liveSquares(level);
  const row = Math.floor(level.player / level.w);
  const cut = new Uint8Array(level.w * level.h);
  for (let i = row * level.w; i < (row + 1) * level.w; i++) {
    if (!level.wall[i] && !live[i]) cut[i] = 1;
  }
  if (level.boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(level.w * level.h).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < level.w * level.h; s++) {
    if (level.wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const d of DIRS) {
        const q = squares[i] + d.dy * level.w + d.dx;
        if (!level.wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of level.boxes) rooms[part[b]].boxes.push(b);
  for (const g of level.goals) if (part[g] >= 0) rooms[part[g]].goals.push(g);
  if (level.goals.some((g) => part[g] < 0)) return null;
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

// Solve one level: room by room, other rooms' boxes standing as walls
// (on their goals once their room is done), the player walking on from
// where the last room left it. Falls back to a whole-level search.
function solveLevel(level: Board): string {
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let moves = '';
    for (const room of rooms) {
      const wall = level.wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        const blockers = (other as Room & { done?: boolean }).done ? other.goals : other.boxes;
        for (const b of blockers) wall[b] = 1;
      }
      const sub: Board = {
        w: level.w,
        h: level.h,
        wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      // A* first; plain BFS over pushes as a deterministic fallback.
      const part = solveAStar(sub) ?? solveAStar(sub, false);
      if (part === null) return '';
      moves += part;
      // Player's square after the part: replay its steps from where it stood.
      for (const ch of part.toLowerCase()) {
        player += ch === 'u' ? -level.w : ch === 'd' ? level.w : ch === 'l' ? -1 : 1;
      }
      (room as Room & { done?: boolean }).done = true;
    }
    return moves;
  }
  return solveAStar(level) ?? solveAStar(level, false) ?? '';
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  const moves = solveLevel(parseLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8')));
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
