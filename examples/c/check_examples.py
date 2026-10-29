"""Compile and check standalone C11 examples; no execution-model instrumentation.

Run from any folder: python <absolute path to this file>
Generated executables and reports go to test-results/standalone-c-examples.
The JSON files beside this checker are control data, not blinded model input.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent.parent


def run_process(arguments, *, stdin=b'', timeout=30):
    return subprocess.run(arguments, input=stdin, capture_output=True, timeout=timeout,
                          env=dict(os.environ, LC_ALL='C'))


def normalized(data):
    return data.decode('utf-8', errors='replace').replace('\r\n', '\n')


def build(cc, source, binary, optimization, allow_signed_warnings=False,
          intentional_error=False):
    flags = ['-std=c11', optimization, '-Wall', '-Wextra', '-Wpedantic',
             '-Wconversion', '-Wstrict-prototypes', '-Werror']
    if allow_signed_warnings:
        flags += ['-Wno-error=sign-compare', '-Wno-error=sign-conversion']
    if intentional_error:
        flags += ['-Wno-error']
    result = run_process([cc, *flags, str(source), '-o', str(binary), '-lm'])
    if result.returncode:
        raise AssertionError(f'{source.name}: compile failed\n{normalized(result.stderr)}')
    return normalized(result.stderr)


def stress_source(names):
    # This checker inspects ordering, references, membership, colors and heights.
    # It does not reproduce either insertion or deletion repair algorithms.
    n = names
    template = r'''
#define main fixtureEntry
#include "@FILE@"
#undef main
#include <stdint.h>
static uint32_t state = UINT32_C(1);
static uint32_t randomValue(void) {
    state = state * UINT32_C(1664525) + UINT32_C(1013904223);
    return state;
}
static void shuffle(int *keys) {
    for (size_t i = 64; i > 1; --i) {
        size_t j = (size_t)randomValue() % i;
        int value = keys[i - 1]; keys[i - 1] = keys[j]; keys[j] = value;
    }
}
static int inspect(const @Tree@ *t, const @Node@ *node, long long low,
                   long long high, const int *expected, int *seen, size_t *count) {
    if (node == &t->@nil@) return 1;
    assert(node->@key@ >= 0 && node->@key@ < 64);
    assert(node->@key@ > low && node->@key@ < high);
    assert(expected[node->@key@] && !seen[node->@key@]);
    seen[node->@key@] = 1;
    assert(node->@color@ == 0 || node->@color@ == 1);
    if (node->@left@ != &t->@nil@) assert(node->@left@->@parent@ == node);
    if (node->@right@ != &t->@nil@) assert(node->@right@->@parent@ == node);
    if (node->@color@ == 1) {
        assert(node->@left@->@color@ == 0);
        assert(node->@right@->@color@ == 0);
    }
    int a = inspect(t, node->@left@, low, node->@key@, expected, seen, count);
    int b = inspect(t, node->@right@, node->@key@, high, expected, seen, count);
    assert(a == b);
    ++*count;
    return a + (node->@color@ == 0);
}
static void verify(const @Tree@ *t, const int *expected) {
    assert(t->@nil@.@color@ == 0);
    assert(t->@root@ == &t->@nil@ || t->@root@->@color@ == 0);
    assert(t->@root@ == &t->@nil@ || t->@root@->@parent@ == &t->@nil@);
    int seen[64] = {0}; size_t count = 0;
    int height = inspect(t, t->@root@, LLONG_MIN, LLONG_MAX, expected, seen, &count);
    assert(height > 0 && count == t->@length@);
    for (int i = 0; i < 64; ++i) assert(seen[i] == expected[i]);
}
int main(void) {
    for (int round = 0; round < 100; ++round) {
        @Tree@ t; @init@(&t);
        int expected[64] = {0}, keys[64];
        for (int i = 0; i < 64; ++i) keys[i] = i;
        shuffle(keys);
        for (int i = 0; i < 64; ++i) {
            int ok = @insert@(&t, keys[i]); assert(ok);
            expected[keys[i]] = 1; verify(&t, expected);
        }
        int duplicate = @insert@(&t, keys[0]); assert(duplicate);
        verify(&t, expected);
        shuffle(keys);
        for (int i = 0; i < 64; ++i) {
            int ok = @erase@(&t, keys[i]); assert(ok);
            expected[keys[i]] = 0; verify(&t, expected);
        }
        int missing = @erase@(&t, 1000); assert(!missing);
        @destroy@(&t);
        verify(&t, expected);
    }
    puts("100 12800");
    return 0;
}
'''
    template = template.replace('@FILE@', (BASE / 'blind' / 'No34.c').as_posix())
    for key, value in n.items():
        template = template.replace('@'+key+'@', value)
    if '@' in template:
        raise AssertionError('Unresolved stress-check placeholder')
    return template


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cc', default=os.environ.get('CC', 'gcc'))
    parser.add_argument('--start', type=int, default=1,
                        help='Resume at this example number (default: 1)')
    args = parser.parse_args()
    output = ROOT / 'test-results' / 'standalone-c-examples'
    output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((BASE / 'example-cases.json').read_text(encoding='utf-8'))
    names = json.loads((BASE / 'example-names.json').read_text(encoding='utf-8'))
    for example in manifest['examples']:
        source = BASE / example['file']
        if hashlib.sha256(source.read_bytes()).hexdigest() != example['sha256']:
            raise AssertionError(f'{source.name}: content changed from the verified fixture')
    selected = [e for e in manifest['examples'] if e['number'] >= args.start]
    if not selected:
        parser.error('--start is past the last example')
    reports, compilations = [], []
    for example in selected:
        source = BASE / example['file']
        actual_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        if actual_hash != example['sha256']:
            raise AssertionError(f'{source.name}: content changed from the verified fixture')
        for optimization in ['-O0', '-O2']:
            binary = output / (source.stem + optimization + '.exe')
            compile_only = example.get('mode') == 'compile-only'
            diagnostics = build(args.cc, source, binary, optimization,
                                example['number'] == 2, compile_only)
            compilations.append(dict(file=source.name, optimization=optimization,
                                     mode='compile-only' if compile_only else 'compile-and-run',
                                     passed=True, sha256=actual_hash))
            for index, case in enumerate(example['cases'], 1):
                result = run_process([str(binary)], stdin=case['stdin'].encode('utf-8'), timeout=30)
                stdout, stderr = normalized(result.stdout), normalized(result.stderr)
                if result.returncode != case['exit'] or stdout != case['stdout']:
                    raise AssertionError(f'{source.name} {optimization} case {index}: '
                        f'exit={result.returncode}, stdout={stdout!r}, stderr={stderr!r}')
                prefix = case.get('stderrPrefix')
                if prefix is not None:
                    if not stderr.startswith(prefix): raise AssertionError(stderr)
                elif stderr:
                    raise AssertionError(f'{source.name}: unexpected stderr {stderr!r}')
                reports.append(dict(file=source.name, optimization=optimization,
                                    case=index, exit=result.returncode, passed=True))
            (output / (source.stem + optimization + '.warnings.txt')).write_text(diagnostics, encoding='utf-8')
        print(source.name + (': compiled only (intentional error)' if compile_only else ': passed'), flush=True)
    harness = output / 'rb-stress.c'
    harness.write_text(stress_source(names['34']['identifiers']), encoding='utf-8')
    stress_options = ['-O0', '-O2'] if any(e['number'] == 34 for e in selected) else []
    for optimization in stress_options:
        binary = output / ('rb-stress' + optimization + '.exe')
        build(args.cc, harness, binary, optimization)
        result = run_process([str(binary)], timeout=15)
        if result.returncode or normalized(result.stdout) != '100 12800\n' or result.stderr:
            raise AssertionError(f'Randomized invariant check failed: {result!r}')
    report = dict(standard='C11', compiler=args.cc, exampleCount=len(selected),
                  suiteExampleCount=len(manifest['examples']), start=args.start,
                  executions=len(reports), passed=True, cases=reports, compilations=compilations,
                  normalExamples=sum(e.get('mode') != 'compile-only' for e in selected),
                  compileOnlyErrorExamples=sum(e.get('mode') == 'compile-only' for e in selected),
                  redBlackStress=dict(optimizations=['-O0','-O2'], roundsPerBuild=100,
                                      mutationsPerBuild=12800,
                                      checks=['membership','ordering','unique nodes','parent references',
                                              'root color','red-parent exclusion','equal black heights']) if stress_options else None,
                  scope='Ordinary C execution only; no visualization instrumentation.')
    report_name = 'report.json' if args.start == 1 else f'report-from-{args.start}.json'
    (output / report_name).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f"PASS: {report['normalExamples']} normal programs, "
          f"{report['compileOnlyErrorExamples']} compile-only error programs, "
          f"{report['executions']} input/output executions." +
          (' Red-black invariants passed 12800 mutations per build.' if stress_options else ''), flush=True)


if __name__ == '__main__':
    main()
