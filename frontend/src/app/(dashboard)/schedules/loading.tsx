export default function RouteLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 sm:p-6"
    >
      <span className="sr-only">正在加载</span>
      <div className="h-8 w-48 animate-pulse rounded-[6px] bg-default-200" />
      <div className="mt-2 grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-[8px] border border-divider bg-content1" />
        ))}
      </div>
    </main>
  );
}
