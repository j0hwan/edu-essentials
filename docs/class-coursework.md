# Class coursework

The shared class editor follows **Info → Schedule → Coursework → Customize** for both Add Class and Edit Class. Existing classes can navigate directly to Coursework using the progress controls.

Coursework is part of the class draft, not another dialog or form. Category and task edits remain in the draft when navigating between steps. They are committed together with the class in one workspace snapshot; attachment uploads retain the existing retry behavior. Canceling a changed draft requires confirmation.

The Coursework layout follows Schedule: compact category cards on the left, the selected category and its tasks on the right, and add buttons below their lists. The pencil beside a selected category opens its name and weight controls. Only one task editor is expanded at a time. All wizard steps keep their header and footer outside the scrolling body; narrow layouts stack the editor fields and bound the category list.

## Categories

`CourseDetails.gradingCategories` optionally stores up to 50 categories with stable `id`, `name`, and percentage `weight` fields. Names are unique after trimming and case folding. Individual weights must be finite and between 0 and 100; totals may be unfinished. The editor reports the allocation and explains that unfinished weights can be saved and completed later. It does not calculate a course grade or change GPA records.

Removing a category requires choosing a destination and confirming the removal inline. Its tasks move to that category or to Uncategorized; they are never implicitly deleted. Existing uncategorized tasks and legacy free-text assignment weights retain their meaning.

## Tasks and scores

Task records retain their existing IDs, notes, checklist, completion metadata, and other fields. Optional fields add `categoryId`, `pointsPossible`, and `pointsEarned`. Point values may be decimal numbers; possible points must be positive. An entered zero earned score is different from an absent score. Earned points above possible points are allowed and labeled as extra credit.

Completion and grading are separate controls. A completed task without a score remains awaiting a grade. Selecting Grade received leaves the score blank until the user explicitly enters it. An incomplete numeric draft cannot be saved. Marking a graded task incomplete clears its earned score while retaining possible points; the existing standalone completion controls request confirmation before doing so.

Due date and time are optional for coursework tasks. An undated task uses an empty `dateKey` and has no due time. Calendar events still require valid dates. The standalone Add Task flow is otherwise unchanged.

## Verification

Use `node --test tests/coursework.test.mjs tests/class-coursework.test.mjs tests/class-coursework-layout.test.mjs tests/class-setup-coursework.test.mjs tests/class-setup.test.mjs tests/academics.test.mjs tests/academic-editor-coursework.test.mjs tests/class-setup-layout.test.mjs` for the focused data, interaction, wizard, persistence, and layout regressions. The class setup scenarios in `tests/settings-ui.test.mjs` also exercise workspace saves and reloads.
