[![make.fun](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Jhoni1098/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Jhoni1098/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

# Sokoban solver

A push-optimal Sokoban solver for the [make.fun bounty](https://make.fun/bounty/sokoban-solver-01-run-20261121): one program answers 5 instances, each scored by fewest pushes.

## How it works

Each level is a hallway with independent rooms off it — a box pushed out of a
room can never come back, so every room's boxes stay on that room's goals.
The solver splits the level into rooms (cutting the hallway's dead squares
out of the floor), solves each room on its own with A\* over pushes, and
stitches the rooms together by walking the player between them.

- **Search:** A\* over push states. A state is the sorted box squares plus
  the player's reachable region; the heuristic is the minimum-cost assignment
  of boxes to goals by wall-only walking distance, which never overestimates,
  so the first solved state found is push-optimal.
- **Pruning:** dead squares (a box that can never be pulled back to a goal)
  and frozen 2×2 blocks of walls and boxes.
- **Fallback:** if A\* exhausts its state budget on a room, plain
  breadth-first search over pushes retries it.
- **Determinism:** budgets are counted in expanded states, never in wall
  time, so two runs write identical bytes.

## Practice result

On the kit's practice set the solver scores **1,000,000 / 1,000,000**:
every instance solved in exactly its push-optimal count (13, 16, 29, 47 and
60 pushes), in about half a second for the whole set. It also scores
1,000,000 on three freshly drawn sets from the same generator.

## Run

```sh
node main.ts
```

It reads `/input/<id>/level.txt` for each instance and writes
`/output/<id>/solution.txt` (or set `MAKEFUN_INPUT_DIR` /
`MAKEFUN_OUTPUT_DIR` to run it locally). Node 22+, no dependencies, no
network.
