"use client";

import CourseIcon from "./course-icon";
import { X } from "lucide-react";
import CourseEditTransition from "./course-edit-transition";
import CourseImageFrame from "./course-image-frame";
import ExpandedCourseImage from "./expanded-course-image";
import { PrivateImage } from "./private-files";
import { courseImageLoadKey } from "./dashboard-load-transition";
import type { Course, CourseDetails } from "../lib/academics";
import type { PrivateFile } from "../lib/files";
import type { FileStore } from "./use-private-files";

export type CourseVisualProps = {
  course: Course;
  details?: CourseDetails;
  image?: PrivateFile;
  profileId: string;
  store: FileStore;
  filesReady: boolean;
  restored: boolean;
  cacheEnabled: boolean;
  close?: () => void;
  onImageSettled?: (key: string) => void;
};

export default function CourseVisual({
  course,
  details,
  image,
  profileId,
  store,
  filesReady,
  restored,
  cacheEnabled,
  close,
  onImageSettled,
}: CourseVisualProps) {
  return <div className={`class-card-visual${close ? " expanded-class-header" : ""}`}>
    <CourseEditTransition revision={JSON.stringify([course.soft, course.color, image?.id, image?.content_revision, details?.imageFraming])}><div className="class-card-media" data-course-morph="visual" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${course.soft}, color-mix(in srgb, ${course.color} 18%, white))` }}>
      <CourseImageFrame framing={details?.imageFraming} fileId={image?.id} courseId={course.id} expanded={Boolean(close)}>{close ? <ExpandedCourseImage profileId={profileId} courseId={course.id} file={image} store={store} filesReady={filesReady} restored={restored} cacheEnabled={cacheEnabled} /> : image ? <PrivateImage key={image.id} file={image} store={store} onSettled={onImageSettled ? () => onImageSettled(courseImageLoadKey(image)) : undefined} /> : null}</CourseImageFrame>
    </div></CourseEditTransition>
    <CourseEditTransition revision={course.initials}><span className="course-watermark" data-course-morph="watermark" aria-hidden="true">{course.initials}</span></CourseEditTransition><CourseEditTransition revision={JSON.stringify([course.code, course.color])}><span className="course-pill" data-course-morph="code" style={{ color: course.color }}>{course.code}</span></CourseEditTransition><CourseEditTransition revision={JSON.stringify([details?.icon, course.color])}><CourseIcon icon={details?.icon} data-course-morph="icon" size={close ? 44 : 34} style={{ color: course.color }} aria-hidden="true" /></CourseEditTransition>
    {close && <button className="secondary-button" onClick={close}>Close class <X size={15} /></button>}
  </div>;
}
