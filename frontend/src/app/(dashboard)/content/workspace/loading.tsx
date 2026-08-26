export default function ContentWorkspaceLoading() {
  return (
    <main aria-busy="true" aria-live="polite" className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 sm:p-6">
      <span className="sr-only">正在加载内容工作台</span>
      <div className="h-8 w-48 animate-pulse rounded-[6px] bg-default-200" />
      <div className="flex gap-4">
        <div className="h-[600px] w-64 animate-pulse rounded-[8px] border border-divider bg-content1" />
        <div className="flex-1 space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-[8px] border border-divider bg-content1" />
          ))}
        </div>
      </div>
    </main>
  );
}
