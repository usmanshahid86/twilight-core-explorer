export function Footer() {
  return (
    <footer className="border-t border-card-border">
      <div className="mx-auto w-full lg:w-[1432px] px-4 sm:px-6 lg:px-[156px] py-6 text-xs text-text-muted">
        <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
          <span>Twilight Core Explorer — operator-grade network operations console.</span>
          <span>Read-only · data from the public API · native denom utwlt (TWLT).</span>
        </div>
      </div>
    </footer>
  );
}
