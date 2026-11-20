"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { ArrowRight, Pencil, Upload } from "lucide-react";
import AcademicEditor from "./academic-editor";
import ClassSetup from "./class-setup";
import ClassSyllabusImport from "./class-syllabus-import";
import { CourseSyllabusUpload } from "./course-syllabus-upload";
import { DeleteSyllabusDialog } from "./delete-syllabus-dialog";
import { SyllabusAttachment, SyllabusTextPreview } from "./course-syllabus";
import ModalPresence from "./modal-presence";
import SyllabusReview from "./syllabus-review";
import { useClassSetupMotion, type ClassSetupBounds } from "./use-class-setup-motion";

export type WorkspaceAcademicKeyedDialog<Props> = { key: string; props: Props };
export type WorkspaceAcademicPresenceBoundary = { key: string; animateExit: boolean };

export type WorkspaceAddClassChoiceProps = {
  initialBounds?: ClassSetupBounds;
  focusManualEntry?: boolean;
  onClose: () => void;
  onImportSyllabus: (initialBounds?: ClassSetupBounds) => void;
  onManualEntry: (initialBounds?: ClassSetupBounds) => void;
};

export type WorkspaceAcademicDialogsProps = {
  classChoicePresence: WorkspaceAcademicPresenceBoundary;
  classChoice?: WorkspaceAddClassChoiceProps;
  classSetupPresence: WorkspaceAcademicPresenceBoundary;
  classSetup?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof ClassSetup>>;
  classSyllabusImport?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof ClassSyllabusImport>>;
  academicEditor?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof AcademicEditor>>;
  syllabusReviewPresence: WorkspaceAcademicPresenceBoundary;
  syllabusReview?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof SyllabusReview>>;
  courseSyllabusUpload?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof CourseSyllabusUpload>>;
  syllabusAttachment?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof SyllabusAttachment>>;
  syllabusTextPreview?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof SyllabusTextPreview>>;
  deleteSyllabus?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof DeleteSyllabusDialog>>;
};

export function WorkspaceAcademicDialogs({ classChoicePresence, classChoice, classSetupPresence, classSetup, classSyllabusImport, academicEditor, syllabusReviewPresence, syllabusReview, courseSyllabusUpload, syllabusAttachment, syllabusTextPreview, deleteSyllabus }: WorkspaceAcademicDialogsProps) {
  return <>
    <ModalPresence key={classChoicePresence.key} animateExit={classChoicePresence.animateExit}>{classChoice ? <AddClassChoiceDialog {...classChoice} /> : null}</ModalPresence>
    <ModalPresence key={classSetupPresence.key} animateExit={classSetupPresence.animateExit}>{classSetup ? <ClassSetup key={classSetup.key} {...classSetup.props} /> : null}</ModalPresence>
    {classSyllabusImport ? <ClassSyllabusImport key={classSyllabusImport.key} {...classSyllabusImport.props} /> : null}
    {academicEditor ? <AcademicEditor key={academicEditor.key} {...academicEditor.props} /> : null}
    <ModalPresence key={syllabusReviewPresence.key} animateExit={syllabusReviewPresence.animateExit}>{syllabusReview ? <SyllabusReview key={syllabusReview.key} {...syllabusReview.props} /> : null}</ModalPresence>
    {courseSyllabusUpload ? <CourseSyllabusUpload key={courseSyllabusUpload.key} {...courseSyllabusUpload.props} /> : null}
    {syllabusAttachment ? <SyllabusAttachment key={syllabusAttachment.key} {...syllabusAttachment.props} /> : null}
    {deleteSyllabus ? <DeleteSyllabusDialog key={deleteSyllabus.key} {...deleteSyllabus.props} /> : null}
    {syllabusTextPreview ? <SyllabusTextPreview key={syllabusTextPreview.key} {...syllabusTextPreview.props} /> : null}
  </>;
}

function AddClassChoiceDialog({ initialBounds, focusManualEntry, onClose, onImportSyllabus, onManualEntry }: WorkspaceAddClassChoiceProps) {
  const choiceRef = useRef<HTMLElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const manualButton = useRef<HTMLButtonElement>(null);
  const transition = useClassSetupMotion(choiceRef, null, initialBounds);
  useEffect(() => {
    if (initialBounds) (focusManualEntry ? manualButton : importButton).current?.focus({ preventScroll: true });
  }, [initialBounds, focusManualEntry]);

  return <div className="modal-backdrop">
      <section ref={choiceRef} className="small-modal add-class-choice-modal" data-morphing-entry={initialBounds ? true : undefined} role="dialog" aria-modal="true" aria-label="Add a class">
        <div className="modal-header">
          <div>
            <h2>Add a class</h2>
          </div>
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
        <div className="add-class-choices">
          <button ref={importButton} className="add-class-choice add-class-choice-import" aria-label="Scan Syllabus" aria-describedby="add-class-import-description" onClick={() => transition(onImportSyllabus)}>
            <span className="add-class-choice-icon"><Upload size={24} aria-hidden="true" /></span>
            <span className="add-class-choice-title">Scan Syllabus</span>
            <span className="add-class-choice-description" id="add-class-import-description">Use a syllabus PDF to fill in your class details, schedule, and tasks.</span>
            <ArrowRight className="add-class-choice-arrow" size={18} aria-hidden="true" />
          </button>
          <button ref={manualButton} className="add-class-choice add-class-choice-manual" aria-label="Manual entry" aria-describedby="add-class-manual-description" onClick={() => transition(onManualEntry)}>
            <span className="add-class-choice-icon"><Pencil size={24} aria-hidden="true" /></span>
            <span className="add-class-choice-title">Manual entry</span>
            <span className="add-class-choice-description" id="add-class-manual-description">Start with your class details and add assignments as you go.</span>
            <ArrowRight className="add-class-choice-arrow" size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>;
}
