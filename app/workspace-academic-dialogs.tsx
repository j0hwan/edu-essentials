"use client";

import type { ComponentProps, Ref } from "react";
import { ArrowRight, Pencil, Upload } from "lucide-react";
import AcademicEditor from "./academic-editor";
import ClassSetup from "./class-setup";
import { CourseSyllabusUpload } from "./course-syllabus-upload";
import { DeleteSyllabusDialog } from "./delete-syllabus-dialog";
import { SyllabusAttachment, SyllabusTextPreview } from "./course-syllabus";
import ModalPresence from "./modal-presence";
import SyllabusReview from "./syllabus-review";

export type WorkspaceAcademicKeyedDialog<Props> = { key: string; props: Props };
export type WorkspaceAcademicPresenceBoundary = { key: string; animateExit: boolean };

export type WorkspaceAddClassChoiceProps = {
  choiceRef: Ref<HTMLElement>;
  onClose: () => void;
  onImportSyllabus: () => void;
  onManualEntry: () => void;
};

export type WorkspaceAcademicDialogsProps = {
  classChoicePresence: WorkspaceAcademicPresenceBoundary;
  classChoice?: WorkspaceAddClassChoiceProps;
  classSetupPresence: WorkspaceAcademicPresenceBoundary;
  classSetup?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof ClassSetup>>;
  academicEditor?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof AcademicEditor>>;
  syllabusReviewPresence: WorkspaceAcademicPresenceBoundary;
  syllabusReview?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof SyllabusReview>>;
  courseSyllabusUpload?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof CourseSyllabusUpload>>;
  syllabusAttachment?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof SyllabusAttachment>>;
  syllabusTextPreview?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof SyllabusTextPreview>>;
  deleteSyllabus?: WorkspaceAcademicKeyedDialog<ComponentProps<typeof DeleteSyllabusDialog>>;
};

export function WorkspaceAcademicDialogs({ classChoicePresence, classChoice, classSetupPresence, classSetup, academicEditor, syllabusReviewPresence, syllabusReview, courseSyllabusUpload, syllabusAttachment, syllabusTextPreview, deleteSyllabus }: WorkspaceAcademicDialogsProps) {
  return <>
    <ModalPresence key={classChoicePresence.key} animateExit={classChoicePresence.animateExit}>{classChoice ? <AddClassChoiceDialog {...classChoice} /> : null}</ModalPresence>
    <ModalPresence key={classSetupPresence.key} animateExit={classSetupPresence.animateExit}>{classSetup ? <ClassSetup key={classSetup.key} {...classSetup.props} /> : null}</ModalPresence>
    {academicEditor ? <AcademicEditor key={academicEditor.key} {...academicEditor.props} /> : null}
    <ModalPresence key={syllabusReviewPresence.key} animateExit={syllabusReviewPresence.animateExit}>{syllabusReview ? <SyllabusReview key={syllabusReview.key} {...syllabusReview.props} /> : null}</ModalPresence>
    {courseSyllabusUpload ? <CourseSyllabusUpload key={courseSyllabusUpload.key} {...courseSyllabusUpload.props} /> : null}
    {syllabusAttachment ? <SyllabusAttachment key={syllabusAttachment.key} {...syllabusAttachment.props} /> : null}
    {deleteSyllabus ? <DeleteSyllabusDialog key={deleteSyllabus.key} {...deleteSyllabus.props} /> : null}
    {syllabusTextPreview ? <SyllabusTextPreview key={syllabusTextPreview.key} {...syllabusTextPreview.props} /> : null}
  </>;
}

function AddClassChoiceDialog({ choiceRef, onClose, onImportSyllabus, onManualEntry }: WorkspaceAddClassChoiceProps) {
  return <div className="modal-backdrop">
      <section ref={choiceRef} className="small-modal add-class-choice-modal" role="dialog" aria-modal="true" aria-label="Add a class">
        <div className="modal-header">
          <div>
            <h2>Add a class</h2>
          </div>
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
        <div className="add-class-choices">
          <button className="add-class-choice add-class-choice-import" aria-label="Import syllabus" aria-describedby="add-class-import-description" onClick={onImportSyllabus}>
            <span className="add-class-choice-icon"><Upload size={24} aria-hidden="true" /></span>
            <span className="add-class-choice-title">Import syllabus</span>
            <span className="add-class-choice-description" id="add-class-import-description">Upload or paste your syllabus, then review your class details and assignments.</span>
            <ArrowRight className="add-class-choice-arrow" size={18} aria-hidden="true" />
          </button>
          <button className="add-class-choice add-class-choice-manual" aria-label="Manual entry" aria-describedby="add-class-manual-description" onClick={onManualEntry}>
            <span className="add-class-choice-icon"><Pencil size={24} aria-hidden="true" /></span>
            <span className="add-class-choice-title">Manual entry</span>
            <span className="add-class-choice-description" id="add-class-manual-description">Start with your class details and add assignments as you go.</span>
            <ArrowRight className="add-class-choice-arrow" size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>;
}
