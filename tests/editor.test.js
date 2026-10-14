import assert from "node:assert/strict";
import { test } from "node:test";
import { enterEdit, tabEdit } from "../src/editor.js";

const apply = (value, edit) => value.slice(0, edit.start) + edit.text + value.slice(edit.end);

test("Tab inserts a real tab at the caret", () => {
  const edit = tabEdit("ab", 1, 1);
  assert.equal(apply("ab", edit), "a\tb");
  assert.equal(edit.selectionStart, 2);
});

test("selected lines indent and outdent without losing text or selection", () => {
  const value = "alpha\nbeta\ngamma";
  const edit = tabEdit(value, 2, 8);
  const indented = apply(value, edit);
  assert.equal(indented, "\talpha\n\tbeta\ngamma");
  const reverse = tabEdit(indented, edit.selectionStart, edit.selectionEnd, true);
  assert.equal(apply(indented, reverse), value);
  assert.deepEqual([reverse.selectionStart, reverse.selectionEnd], [2, 8]);
});

test("selection ending at column one excludes the following line", () => {
  assert.equal(apply("a\nb\nc", tabEdit("a\nb\nc", 0, 4)), "\ta\n\tb\nc");
});

test("Shift+Tab removes one tab or up to four spaces", () => {
  const value = "\talpha\n    beta\n  gamma\ndelta";
  assert.equal(apply(value, tabEdit(value, 0, value.length, true)), "alpha\nbeta\ngamma\ndelta");
  const edit = tabEdit("    alpha", 2, 2, true);
  assert.equal(apply("    alpha", edit), "alpha");
  assert.equal(edit.selectionStart, 0);
});

test("Enter creates an indented blank line between braces", () => {
  const value = "\tif (1) {  }";
  const edit = enterEdit(value, 9, 9);
  assert.equal(apply(value, edit), "\tif (1) {\n\t\t\n\t}");
  assert.equal(edit.selectionStart, 12);
});

test("Enter after an opening brace adds a tab and otherwise preserves indentation", () => {
  for (const [value, expected] of [["int main(){", "int main(){\n\t"], ["\t\tint a;", "\t\tint a;\n\t\t"], ["\t}", "\t}\n\t"]]) {
    assert.equal(apply(value, enterEdit(value, value.length, value.length)), expected);
  }
});
