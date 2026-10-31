"""Extract a high-quality candidate pool of Lichess puzzles mapped to the 10 ECT themes.

Input : /tmp/puzzles.csv.zst (database.lichess.org/lichess_db_puzzle.csv.zst, CC0)
Output: /tmp/candidates.json

The Lichess dump is a sequence of zstd frames, so we read across frames.
"""
import io
import json
import sys

import zstandard as zstd

# ECT theme <=> Lichess theme mapping (single source of truth, mirrored in js/puzzle-db.js)
ECT_THEMES = {
    "annihilation": ["deflection", "trappedPiece", "capturingDefender", "hangingPiece"],
    "blockade": ["zugzwang", "quietMove", "defensiveMove"],
    "clearance": ["clearance", "interference"],
    "deflection": ["deflection", "decoy"],
    "discoveredAttack": ["discoveredAttack", "doubleCheck", "xRayAttack"],
    "pin": ["pin", "skewer"],
    "pawnStructure": ["sacrifice", "kingsideAttack", "exposedKing", "attackingF2F7"],
    "attraction": ["attraction", "decoy"],
    "interference": ["interference", "quietMove"],
    "doubleAttack": ["fork", "doubleThreat", "mateIn1", "mateIn2", "mateIn3"],
}
LICHESS_TO_ECT = {}
for ect, tags in ECT_THEMES.items():
    for tag in tags:
        LICHESS_TO_ECT.setdefault(tag, []).append(ect)

SKIP_THEMES = ("mateIn4", "mateIn5", "veryLong", "equality", "crushing")


def main():
    out = []
    lines = 0
    dctx = zstd.ZstdDecompressor()
    with open("/tmp/puzzles.csv.zst", "rb") as fh:
        reader = io.TextIOWrapper(
            dctx.stream_reader(fh, read_across_frames=True), encoding="utf-8", newline=""
        )
        for line in reader:
            lines += 1
            if lines == 1 and line.startswith("PuzzleId"):
                continue
            c = line.rstrip("\n").split(",")
            if len(c) < 9:
                continue
            try:
                rating = int(c[3])
                rd = int(c[4])
                popularity = int(c[5])
                plays = int(c[6])
            except ValueError:
                continue
            if rating < 700 or rating > 2400:
                continue
            if rd > 100 or popularity < 85 or plays < 500:
                continue
            moves = c[2].split(" ")
            if len(moves) < 2 or len(moves) > 9:
                continue
            themes = c[7].split(" ") if c[7] else []
            if any(t in SKIP_THEMES for t in themes):
                continue
            ect = sorted({e for t in themes for e in LICHESS_TO_ECT.get(t, [])})
            if not ect:
                continue
            out.append(
                {
                    "id": c[0],
                    "fen": c[1],
                    "moves": c[2],
                    "rating": rating,
                    "popularity": popularity,
                    "plies": len(moves),
                    "lichess": themes,
                    "ect": ect,
                }
            )
    with open("/tmp/candidates.json", "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    dist = {}
    for p in out:
        for e in p["ect"]:
            dist[e] = dist.get(e, 0) + 1
    print("lines", lines, "candidates", len(out))
    print(json.dumps(dist, indent=1))


if __name__ == "__main__":
    main()
