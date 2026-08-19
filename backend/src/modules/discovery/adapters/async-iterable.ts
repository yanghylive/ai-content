// 共享异步迭代器工具：在不引入 async generator 的前提下构造 AsyncIterable，
// 供各 adapter 实现 DiscoveryAdapter 契约（fetchInteractions 空产出 / discover 数组包装）。

export function asyncIterableFromArray<T>(
  items: readonly T[],
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let index = 0;
      return {
        next(): Promise<IteratorResult<T>> {
          if (index < items.length) {
            const result: IteratorResult<T> = {
              done: false,
              value: items[index],
            };
            index += 1;
            return Promise.resolve(result);
          }
          const result: IteratorResult<T> = { done: true, value: undefined };
          return Promise.resolve(result);
        },
      };
    },
  };
}

export function emptyAsyncIterable(): AsyncIterable<never> {
  return asyncIterableFromArray<never>([]);
}
