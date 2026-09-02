const HOME_METRICS = ['skills', 'mcps', 'subagents'] as const;
const LIST_SECTIONS = [3, 3] as const;

function LoadingStatus() {
  return (
    <span aria-label="Scanning local inventory" className="sr-only" role="status">
      Scanning local inventory
    </span>
  );
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <div className="inventory-skeleton__row" data-row-index={index}>
      <div className="inventory-skeleton__row-copy">
        <span className="inventory-skeleton__shape inventory-skeleton__line inventory-skeleton__line--title" />
        <span className="inventory-skeleton__shape inventory-skeleton__line inventory-skeleton__line--copy" />
      </div>
      <span className="inventory-skeleton__shape inventory-skeleton__pill" />
    </div>
  );
}

export function HomeInventoryLoadingSkeleton() {
  return (
    <section aria-busy="true" className="inventory-skeleton inventory-skeleton--home">
      <LoadingStatus />
      <div aria-hidden="true">
        <div className="inventory-skeleton__metrics">
          {HOME_METRICS.map((metric) => (
            <div className="inventory-skeleton__metric" key={metric}>
              <span className="inventory-skeleton__shape inventory-skeleton__line inventory-skeleton__line--label" />
              <span className="inventory-skeleton__shape inventory-skeleton__value" />
              <div className="inventory-skeleton__metric-status">
                <span className="inventory-skeleton__shape inventory-skeleton__dot" />
                <span className="inventory-skeleton__shape inventory-skeleton__line inventory-skeleton__line--status" />
              </div>
            </div>
          ))}
        </div>

        <div className="inventory-skeleton__status-strip">
          <span className="inventory-skeleton__shape inventory-skeleton__status-icon" />
          <div className="inventory-skeleton__status-copy">
            <span className="inventory-skeleton__shape inventory-skeleton__line inventory-skeleton__line--status-title" />
            <span className="inventory-skeleton__shape inventory-skeleton__line inventory-skeleton__line--status-copy" />
          </div>
        </div>

        <div className="inventory-skeleton__card">
          <div className="inventory-skeleton__card-header">
            <span className="inventory-skeleton__shape inventory-skeleton__line inventory-skeleton__line--card-title" />
          </div>
          {[0, 1, 2].map((index) => <SkeletonRow index={index} key={index} />)}
        </div>
      </div>
    </section>
  );
}

export function InventoryListLoadingSkeleton() {
  return (
    <section aria-busy="true" className="inventory-skeleton inventory-skeleton--list">
      <LoadingStatus />
      <div aria-hidden="true">
        {LIST_SECTIONS.map((rowCount, sectionIndex) => (
          <div className="inventory-skeleton__section" key={sectionIndex}>
            <div className="inventory-skeleton__section-header">
              <span className="inventory-skeleton__shape inventory-skeleton__section-label" />
              <span className="inventory-skeleton__shape inventory-skeleton__section-count" />
            </div>
            {Array.from({ length: rowCount }, (_, rowIndex) => (
              <SkeletonRow index={rowIndex} key={rowIndex} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
