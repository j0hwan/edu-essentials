"use client";

import "./expanded-course-skeleton.css";

export type ExpandedCourseSkeletonProps = {
  reducedMotion?: boolean;
};

export function ExpandedCourseSkeleton({ reducedMotion = false }: ExpandedCourseSkeletonProps) {
  return (
    <div
      className={`expanded-course-skeleton${reducedMotion ? " expanded-course-skeleton--reduced" : ""}`}
      role="status"
      aria-label="Loading expanded course"
      aria-busy="true"
    >
      <div className="expanded-course-skeleton__decoration" aria-hidden="true" inert>
        <div className="expanded-course-skeleton__hero">
          <div className="expanded-course-skeleton__button expanded-course-skeleton__close" />
          <div className="expanded-course-skeleton__course-badge" />
        </div>

        <div className="expanded-course-skeleton__body expanded-class-body">
          <div className="expanded-course-skeleton__heading">
            <div className="expanded-course-skeleton__actions">
              <div className="expanded-course-skeleton__button expanded-course-skeleton__add" />
              <div className="expanded-course-skeleton__button expanded-course-skeleton__edit" />
            </div>
          </div>

          <div className="expanded-course-skeleton__grid">
            <section className="expanded-course-skeleton__section expanded-course-skeleton__notes" />
            <section className="expanded-course-skeleton__section expanded-course-skeleton__schedule">
              <div className="expanded-course-skeleton__button expanded-course-skeleton__view-schedule" />
            </section>
            <section className="expanded-course-skeleton__section expanded-course-skeleton__syllabus">
              <div className="expanded-course-skeleton__actions">
                <div className="expanded-course-skeleton__button expanded-course-skeleton__import" />
                <div className="expanded-course-skeleton__button expanded-course-skeleton__delete" />
              </div>
            </section>
          </div>

          <section className="expanded-course-skeleton__section expanded-course-skeleton__assignments" />
        </div>
      </div>
    </div>
  );
}

export default ExpandedCourseSkeleton;
