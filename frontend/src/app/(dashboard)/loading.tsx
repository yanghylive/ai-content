export default function DashboardLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 sm:p-6"
    >
      <span className="sr-only">正在加载页面</span>
      <div className="h-8 w-48 animate-pulse rounded-[6px] bg-default-200" />
      <div className="h-4 w-full max-w-xl animate-pulse rounded-[4px] bg-default-100" />
      <div className="mt-2 grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-32 animate-pulse rounded-[8px] border border-divider bg-content1"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-[8px] border border-divider bg-content1" />
    </main>
  );
}
