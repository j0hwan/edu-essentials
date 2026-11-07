import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";
const { validateGradingCategories, validateAssignmentGrading, mergeCourseworkAssignments } = await import(await clientModule("lib/coursework.ts"));

test("grading categories normalize names and validate bounded unique values", () => {
  assert.deepEqual(validateGradingCategories([{ id: "hw", name: " Homework ", weight: 12.5 }]), [{ id: "hw", name: "Homework", weight: 12.5 }]);
  for (const value of [null, Array(51).fill({ id: "a", name: "A", weight: 1 }), [{ id: "", name: "A", weight: 1 }], [{ id: "a", name: " ", weight: 1 }], [{ id: "a", name: "A", weight: 101 }], [{ id: "a", name: "A", weight: 1 }, { id: "b", name: " a ", weight: 2 }]]) assert.throws(() => validateGradingCategories(value));
  assert.equal(validateGradingCategories([{ id: "a", name: "A", weight: 0.1 }, { id: "b", name: "B", weight: 99.9 }]).length, 2);
});

test("assignment grading accepts extra credit and rejects invalid points", () => {
  assert.doesNotThrow(() => validateAssignmentGrading({ categoryId: "hw", pointsPossible: 10, pointsEarned: 12, status: "done" }));
  assert.doesNotThrow(() => validateAssignmentGrading({ pointsEarned: 0, pointsPossible: 1, status: "done" }));
  for (const value of [{ pointsPossible: 0 }, { pointsPossible: Infinity }, { pointsEarned: 1 }, { pointsPossible: 2, pointsEarned: 1, status: "later" }, { categoryId: "x".repeat(121) }]) assert.throws(() => validateAssignmentGrading(value));
});

test("coursework merge replaces one course while preserving others", () => {
  const old = { id: "old", courseId: "c", title: "Old", status: "later", progress: 0, weight: "legacy 20%", description: "" };
  const other = { ...old, id: "other", courseId: "d" };
  const replacement = { ...old, id: "new", title: "New" };
  assert.deepEqual(mergeCourseworkAssignments([old, other], "c", [replacement]), [other, replacement]);
  assert.throws(() => mergeCourseworkAssignments([other], "c", [{ ...replacement, courseId: "d" }]));
  assert.throws(() => mergeCourseworkAssignments([other], "c", [{ ...replacement, id: "other" }]));
});
