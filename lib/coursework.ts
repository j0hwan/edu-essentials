export type GradingCategory = { id: string; name: string; weight: number };

export function validateGradingCategories(value: unknown): GradingCategory[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("Invalid grading categories.");
  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid grading category.");
    const category = raw as Record<string, unknown>;
    if (typeof category.id !== "string" || !category.id.trim() || category.id.length > 120 || ids.has(category.id)) throw new Error("Invalid or duplicate grading category ID.");
    if (typeof category.name !== "string" || !category.name.trim() || category.name.length > 100) throw new Error("Invalid grading category name.");
    const normalizedName = category.name.trim().toLowerCase();
    if (names.has(normalizedName)) throw new Error("Duplicate grading category name.");
    if (typeof category.weight !== "number" || !Number.isFinite(category.weight) || category.weight < 0 || category.weight > 100) throw new Error("Invalid grading category weight.");
    ids.add(category.id);
    names.add(normalizedName);
    return { id: category.id, name: category.name.trim(), weight: category.weight };
  });
}

export function validateAssignmentGrading(value: { categoryId?: unknown; pointsPossible?: unknown; pointsEarned?: unknown; status?: unknown }): void {
  const { categoryId, pointsPossible, pointsEarned, status } = value;
  if (categoryId !== undefined && categoryId !== "" && (typeof categoryId !== "string" || !categoryId.trim() || categoryId.length > 120)) throw new Error("Invalid assignment category.");
  const validPoints = (points: unknown, positive: boolean) => points === undefined || points === null || (typeof points === "number" && Number.isFinite(points) && points >= (positive ? Number.MIN_VALUE : 0) && points <= 1e9);
  if (!validPoints(pointsPossible, true)) throw new Error("Invalid points possible.");
  if (!validPoints(pointsEarned, false)) throw new Error("Invalid points earned.");
  if (pointsEarned !== undefined && pointsEarned !== null && (pointsPossible === undefined || pointsPossible === null)) throw new Error("Points earned requires points possible.");
  if (pointsEarned !== undefined && pointsEarned !== null && status !== "done") throw new Error("Points earned requires a completed assignment.");
}

export function mergeCourseworkAssignments<T extends { id: string; courseId: string; title: string; status: string; progress: number; weight: string; description: string; [key: string]: unknown }>(current: T[], courseId: string, draft: T[]): T[] {
  if (!courseId || !Array.isArray(current) || !Array.isArray(draft)) throw new Error("Invalid coursework assignments.");
  const unrelated = current.filter((item) => item.courseId !== courseId);
  const occupiedIds = new Set(unrelated.map((item) => item.id));
  const draftIds = new Set<string>();
  for (const item of draft) {
    if (!item || typeof item !== "object" || item.courseId !== courseId || typeof item.id !== "string" || !item.id || draftIds.has(item.id) || occupiedIds.has(item.id)) throw new Error("Invalid or conflicting coursework assignment.");
    if (typeof item.title !== "string" || !item.title.trim() || !["overdue", "today", "later", "done"].includes(item.status) || typeof item.progress !== "number" || !Number.isFinite(item.progress) || item.progress < 0 || item.progress > 100 || typeof item.weight !== "string" || typeof item.description !== "string") throw new Error("Invalid coursework assignment.");
    validateAssignmentGrading(item);
    draftIds.add(item.id);
  }
  return [...unrelated, ...draft];
}
