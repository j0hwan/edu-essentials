type CoursesSkeletonProps = {
  reducedMotion?: boolean;
};

export function CoursesSkeleton({ reducedMotion = false }: CoursesSkeletonProps) {
  return (
    <div
      className={`page dashboard-page courses-skeleton${reducedMotion ? " courses-skeleton--reduced" : ""}`}
      role="status"
      aria-label="Loading courses"
      aria-busy="true"
    >
      <span className="courses-skeleton__status">Loading courses</span>
      <div className="courses-skeleton__decoration" aria-hidden="true" inert>
        <div className="courses-skeleton__brief courses-skeleton__surface" />

        <section className="courses-skeleton__classes">
          <div className="courses-skeleton__classes-heading">
            <span className="courses-skeleton__section-title" />
            <div className="courses-skeleton__class-actions">
              <span className="courses-skeleton__add-class" />
              <span className="courses-skeleton__view-toggle" />
            </div>
          </div>
          <div className="courses-skeleton__tools">
            <span />
            <span />
            <span />
          </div>
          <div className="courses-skeleton__cards">
            {Array.from({ length: 4 }, (_, index) => (
              <article className="courses-skeleton__class courses-skeleton__surface" key={index} />
            ))}
          </div>
        </section>

        <div className="courses-skeleton__upcoming courses-skeleton__surface" />
      </div>
    </div>
  );
}

export default CoursesSkeleton;
