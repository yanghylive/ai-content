export default function RootLoading() {
  return (
    <main aria-busy="true" aria-live="polite" className="flex min-h-screen w-full items-center justify-center">
      <span className="sr-only">正在加载</span>
      <div className="h-8 w-48 animate-pulse rounded-[6px] bg-default-200" />
    </main>
  );
}
