"""Focused checks for these two examples only; no visualizer code is changed."""
import math
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = Path("test-results/pathfinding-comparison/native")
SOURCES = [Path("examples/c/pathfinding") / name
           for name in ("astar.c", "lwa_star.c")]
RISE = [0, 11, 25, 45, 80, 144]
POINTS = [(0, 0)] + [(300, 5 * y) for y in RISE] + [(600, 0)]


def orient(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def on_segment(a, b, p):
    return (orient(a, b, p) == 0
            and min(a[0], b[0]) <= p[0] <= max(a[0], b[0])
            and min(a[1], b[1]) <= p[1] <= max(a[1], b[1]))


def segments_meet(a, b, c, d):
    x, y = orient(a, b, c), orient(a, b, d)
    z, w = orient(c, d, a), orient(c, d, b)
    return ((x * y < 0 and z * w < 0)
            or on_segment(a, b, c) or on_segment(a, b, d)
            or on_segment(c, d, a) or on_segment(c, d, b))


def hits_rectangle(a, b, r):
    x0, y0, x1, y1 = r
    if any(x0 < p[0] < x1 and y0 < p[1] < y1 for p in (a, b)):
        return True
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    # This fixture has no boundary-only contacts. Integer orientation is
    # independent of the C implementation's floating-point interval clipping.
    return any(segments_meet(a, b, corners[i], corners[(i + 1) % 4])
               for i in range(4))


def oracle(mask):
    rectangles = [(59, RISE[i] - 1, 61, RISE[i] + 1)
                  for i in range(6) if mask & (1 << i)]
    distance = [[10**9] * 8 for _ in range(8)]
    for i in range(8):
        distance[i][i] = 0
    valid = []
    for v in range(1, 7):
        valid.append(not any(hits_rectangle(POINTS[0], POINTS[v], r)
                             for r in rectangles))
        for a, b in ((0, v), (v, 7)):
            squared = sum((POINTS[a][k] - POINTS[b][k]) ** 2 for k in range(2))
            cost = math.isqrt(squared)
            assert cost * cost == squared
            if not any(hits_rectangle(POINTS[a], POINTS[b], r)
                       for r in rectangles):
                distance[a][b] = cost
    assert valid == [not bool(mask & (1 << i)) for i in range(6)]
    for k in range(8):
        for a in range(8):
            for b in range(8):
                distance[a][b] = min(distance[a][b],
                                     distance[a][k] + distance[k][b])
    return distance[0][7], valid


def field(output, name):
    return int(re.search(rf"^{name} (\d+)$", output, re.MULTILINE)[1])


def run(executable, text):
    return subprocess.run([str(executable)], input=text, cwd=ROOT,
                          capture_output=True, text=True, timeout=5)


def main():
    (ROOT / OUTPUT).mkdir(parents=True, exist_ok=True)
    runs = 0
    for optimization in ("-O0", "-O2"):
        for source in SOURCES:
            executable = OUTPUT / (source.stem + optimization + ".exe")
            # Relative compiler paths avoid MinGW linker's non-ASCII-path issue.
            command = ["gcc", "-std=c11", optimization, "-Wall", "-Wextra",
                       "-Wpedantic", "-Wconversion", "-Wstrict-prototypes",
                       "-Werror", str(source), "-o", str(executable)]
            compiled = subprocess.run(command, cwd=ROOT, capture_output=True,
                                      text=True, timeout=30)
            assert compiled.returncode == 0, (source.name, compiled.stderr)
            for mask in range(64):
                result = run(executable, f"{mask}\n")
                assert result.returncode == 0 and not result.stderr, (
                    source.name, mask, result.stderr)
                ready = result.stdout.index("GRAPH_READY vertices=8 edges=12\n")
                search = result.stdout.index("SEARCH_BEGIN\n")
                assert ready < search
                assert not re.search(r"^(OPEN|POP|CHECK|EXPAND) ",
                                     result.stdout[:search], re.MULTILINE)
                expected, valid = oracle(mask)
                if expected < 10**9:
                    path = [int(v) for v in re.search(
                        r"^PATH (.+)$", result.stdout, re.MULTILINE)[1].split()]
                    assert field(result.stdout, "COST") == expected
                    assert path == [0, valid.index(True) + 1, 7]
                else:
                    assert "NO_PATH\n" in result.stdout
                expected_checks = (6 if source.stem == "astar" else
                                   valid.index(True) + 1 if any(valid) else 6)
                assert field(result.stdout, "CHECKS") == expected_checks
                assert field(result.stdout, "EXPANSIONS") == (2 if any(valid) else 1)
                if mask == 3 and optimization == "-O0":
                    (ROOT / OUTPUT / (source.stem + "-default.stdout.txt")).write_text(
                        result.stdout, encoding="utf-8")
                    print(source.name, "\n".join(result.stdout.splitlines()[-9:]))
                runs += 1
            for invalid in ("-1\n", "64\n", "bad\n"):
                result = run(executable, invalid)
                assert result.returncode == 1 and result.stderr
            result = run(executable, "")
            assert result.returncode == 0 and "MASK 3\n" in result.stdout
    print(f"PASS: 4 strict C11 builds, {runs} mask executions, "
          "12 invalid inputs, 4 EOF defaults; "
          "independent integer geometry + Floyd-Warshall oracle.")


if __name__ == "__main__":
    main()
