"""Check only No43.c with ordinary C11 execution, without model instrumentation."""
from pathlib import Path
import argparse
import bisect
import hashlib
import json
import os
import random
import subprocess

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent.parent


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def reference(operations, roots=None):
    values = set()
    records = []
    roots = roots or {}
    for step, (operation, key) in enumerate(operations, 1):
        ordered = sorted(values)
        status, result = 0, 0
        if operation == '+':
            status = 2 if key in values else 1
            values.add(key)
            result = key
        elif operation == '-':
            if key in values:
                values.remove(key)
                status, result = 1, key
        elif operation == '?':
            if key in values:
                status, result = 1, key
        elif operation in ('<', '>', '=', 'm', 'M'):
            if operation == '<': index = bisect.bisect_left(ordered, key) - 1
            elif operation == '>': index = bisect.bisect_right(ordered, key)
            elif operation == '=': index = bisect.bisect_left(ordered, key)
            elif operation == 'm': index = 0
            else: index = len(ordered) - 1
            if 0 <= index < len(ordered):
                status, result = 1, ordered[index]
        elif operation == 'r':
            if values:
                result = roots[step] if step in roots else next(iter(values))
                require(step in roots or len(values) == 1, 'Root deletion needs an a priori root')
                require(result in values, 'Predicted root is absent')
                values.remove(result)
                status = 1
        elif operation == 'c':
            status, result = 1, len(values)
            values.clear()
        elif operation == 'p':
            status = 1
        else:
            raise AssertionError(f'Unsupported reference operation: {operation}')
        keys = sorted(values)
        line = ' '.join(map(str, ['S', step, operation, key, status, result, len(keys), 1, *keys]))
        records.append(dict(keys=keys, line=line))
    return records


def verify_dump(lines, offset, keys):
    require(offset < len(lines), 'Missing T record')
    top = lines[offset].split()
    require(len(top) == 3 and top[0] == 'T', 'Invalid root record')
    present, root = map(int, top[1:])
    require(present == int(bool(keys)), 'Wrong empty-tree state')
    if not present:
        require(root == 0, 'Absent root must have placeholder zero')
        return offset + 1
    require(root in keys, 'Root is not an expected member')
    nodes = {}
    for index, expected_key in enumerate(keys, offset + 1):
        require(index < len(lines), 'Missing N record')
        fields = lines[index].split()
        require(len(fields) == 9 and fields[0] == 'N', 'Invalid node record')
        key, color, hl, left, hr, right, hp, parent = map(int, fields[1:])
        require(key == expected_key and key not in nodes, 'Wrong membership/order or duplicate node')
        require(color in (0, 1), 'Invalid color')
        require(hl in (0, 1) and hr in (0, 1) and hp in (0, 1), 'Invalid presence flag')
        require(hl or left == 0, 'Absent child has a nonzero placeholder')
        require(hr or right == 0, 'Absent child has a nonzero placeholder')
        require(hp or parent == 0, 'Absent parent has a nonzero placeholder')
        nodes[key] = dict(color=color, left=left if hl else None,
                          right=right if hr else None, parent=parent if hp else None)
    require(nodes[root]['color'] == 0 and nodes[root]['parent'] is None,
            'Root must be black and have no real parent')
    visited = set()

    def walk(key, parent, low, high):
        if key is None:
            return 1
        require(key in nodes and key not in visited, 'Cycle, shared child, or unknown child')
        require((low is None or low < key) and (high is None or key < high), 'BST ordering failed')
        node = nodes[key]
        require(node['parent'] == parent, 'Parent link mismatch')
        visited.add(key)
        for child in (node['left'], node['right']):
            if child is not None:
                require(child in nodes, 'Child is not a live member')
                if node['color'] == 1:
                    require(nodes[child]['color'] == 0, 'Adjacent red nodes')
        left_height = walk(node['left'], key, low, key)
        right_height = walk(node['right'], key, key, high)
        require(left_height == right_height, 'Unequal black heights')
        return left_height + (node['color'] == 0)

    walk(root, None, None, None)
    require(visited == set(keys), 'Unreachable or missing live nodes')
    return offset + 1 + len(keys)


def verify_stdout(text, expected, details):
    lines = text.splitlines()
    offset = 0
    for record in expected:
        require(offset < len(lines), 'Missing S record')
        require(lines[offset] == record['line'],
                f"State differs: expected {record['line']!r}, got {lines[offset]!r}")
        offset += 1
        if details:
            offset = verify_dump(lines, offset, record['keys'])
    require(offset == len(lines), 'Unexpected trailing output')


def input_text(operations):
    with_key = set('+-?<>=')
    return ''.join(f'{op} {key}\n' if op in with_key else f'{op}\n'
                   for op, key in operations) + 'q\n'


def process(arguments, stdin='', timeout=30):
    return subprocess.run(arguments, input=stdin.encode('ascii'), capture_output=True,
                          timeout=timeout, env=dict(os.environ, LC_ALL='C'))


def decode(value):
    return value.decode('utf-8', errors='replace').replace('\r\n', '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cc', default=os.environ.get('CC', 'gcc'))
    args = parser.parse_args()
    manifest = json.loads((BASE / 'example-cases.json').read_text(encoding='utf-8'))
    spec = next(item for item in manifest['examples'] if item['number'] == 43)
    source = BASE / spec['file']
    source_bytes = source.read_bytes()
    source_hash = hashlib.sha256(source_bytes).hexdigest()
    require(source_hash == spec['sha256'], 'No43 changed from the planned fixture')
    output = ROOT / 'test-results' / 'standalone-c-examples' / 'No43'
    output.mkdir(parents=True, exist_ok=True)
    default_ops = spec['plannedOperations']
    roots = {int(step): key for step, key in spec['predictedRootDeletes'].items()}
    default_expected = reference(default_ops, roots)
    require('\n'.join(r['line'] for r in default_expected)+'\n' == spec['cases'][0]['stdout'],
            'The frozen default prediction and set specification disagree')
    boundary_ops = [
        ['m',0], ['M',0], ['r',0], ['+',0], ['+',-2147483648], ['+',2147483647],
        ['?',0], ['<',0], ['>',0], ['=',0], ['=',1], ['<',-2147483648],
        ['>',2147483647], ['+',0], ['-',0], ['-',0], ['?',0], ['c',0],
        ['+',0], ['r',0], ['r',0], ['+',-1], ['c',0], ['p',0],
    ]
    rng = random.Random(20261113)
    stress_ops = [[rng.choice('++--?<>=pmmM'), rng.randrange(-32, 33)] for _ in range(600)]
    stress_ops = [[op, key if op in '+-?<>= ' else 0] for op, key in stress_ops]
    stress_ops.append(['c', 0])
    valid_cases = [
        ('demo', [], '', default_expected, False),
        ('demo-dump', ['--dump'], '', default_expected, True),
        ('interactive-demo', ['--interactive','--dump'], input_text(default_ops), default_expected, True),
        ('boundary', ['--interactive','--dump'], input_text(boundary_ops), reference(boundary_ops), True),
        ('mixed-600', ['--interactive','--dump'], input_text(stress_ops), reference(stress_ops), True),
    ]
    bad_inputs = ['+\n', '+ 2147483648\n', '+ -2147483649\n', 'x\n',
                  '+ 1 extra\n', '+'+' '*128+'\n']
    records = []
    for optimization in ('-O0', '-O2'):
        binary = output / ('No43'+optimization+'.exe')
        flags = ['-std=c11', optimization, '-Wall', '-Wextra', '-Wpedantic',
                 '-Wconversion', '-Wstrict-prototypes', '-Werror']
        compiled = process([args.cc, *flags, str(source), '-o', str(binary)])
        require(compiled.returncode == 0 and not compiled.stderr, decode(compiled.stderr))
        states_checked = 0
        for label, options, stdin, expected, details in valid_cases:
            result = process([str(binary), *options], stdin)
            require(result.returncode == 0 and not result.stderr,
                    f'{label}: exit={result.returncode}, stderr={decode(result.stderr)}')
            text = decode(result.stdout)
            verify_stdout(text, expected, details)
            states_checked += len(expected)
            (output / (label+optimization+'.txt')).write_text(text, encoding='utf-8')
            records.append(dict(optimization=optimization, case=label,
                                states=len(expected), topologyChecked=details, passed=True))
        for index, stdin in enumerate(bad_inputs, 1):
            result = process([str(binary), '--interactive', '--dump'], stdin)
            require(result.returncode == 2 and not result.stdout and decode(result.stderr) == 'ERROR\n',
                    f'Invalid input {index} was not rejected cleanly')
            records.append(dict(optimization=optimization, case=f'invalid-{index}', passed=True))
        unknown = process([str(binary), '--unknown'])
        require(unknown.returncode == 2 and not unknown.stdout and decode(unknown.stderr) == 'ERROR\n',
                'Unknown command-line option was not rejected')
        records.append(dict(optimization=optimization, case='invalid-option', passed=True))
        print(f'{optimization}: {states_checked} states checked, invalid input rejected.', flush=True)
    report = dict(file='blind/No43.c', sha256=source_hash, standard='C11',
        compiler=args.cc, flags=flags, passed=True, executions=len(records),
        checkedStates=sum(r.get('states',0) for r in records),
        topologyCheckedStates=sum(r.get('states',0) for r in records if r.get('topologyChecked')),
        checks=['independent set membership and query results', 'duplicate insertion',
                'missing deletion', 'integer boundaries and zero key', 'root deletion',
                'clear and reuse', 'BST order', 'parent/child links', 'root color',
                'no adjacent red nodes', 'equal black heights', 'input range validation'],
        records=records,
        designMapping=[dict(clause='AGENTS.md / 구현·검증 경계',
            change='No43.c와 해당 검증 정보만 추가', evidence='본 보고서와 프로그램 출력',
            remaining='실행 모델 계측·추론·화면 검증은 이번 작업 범위 밖')])
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f"PASS: No43 only; {report['executions']} executions, {report['checkedStates']} states.")


if __name__ == '__main__':
    main()
