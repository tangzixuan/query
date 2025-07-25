import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
  vi,
} from 'vitest'
import { queryKey, sleep } from '@tanstack/query-test-utils'
import { QueryClient, QueryObserver, focusManager } from '..'
import type { QueryObserverResult } from '..'

describe('queryObserver', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          experimental_prefetchInRender: true,
        },
      },
    })
    queryClient.mount()
  })

  afterEach(() => {
    queryClient.clear()
    vi.useRealTimers()
  })

  test('should trigger a fetch when subscribed', () => {
    const key = queryKey()
    const queryFn = vi
      .fn<(...args: Array<unknown>) => string>()
      .mockReturnValue('data')
    const observer = new QueryObserver(queryClient, { queryKey: key, queryFn })
    const unsubscribe = observer.subscribe(() => undefined)
    unsubscribe()
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  test('should be able to read latest data after subscribing', () => {
    const key = queryKey()
    queryClient.setQueryData(key, 'data')
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      enabled: false,
    })

    const unsubscribe = observer.subscribe(vi.fn())

    expect(observer.getCurrentResult()).toMatchObject({
      status: 'success',
      data: 'data',
    })

    unsubscribe()
  })

  describe('enabled is a callback that initially returns false', () => {
    let observer: QueryObserver<string, Error, string, string, Array<string>>
    let enabled: boolean
    let count: number
    let key: Array<string>

    beforeEach(() => {
      key = queryKey()
      count = 0
      enabled = false

      observer = new QueryObserver(queryClient, {
        queryKey: key,
        staleTime: Infinity,
        enabled: () => enabled,
        queryFn: async () => {
          await sleep(10)
          count++
          return 'data'
        },
      })
    })

    test('should not fetch on mount', () => {
      const unsubscribe = observer.subscribe(vi.fn())

      // Has not fetched and is not fetching since its disabled
      expect(count).toBe(0)
      expect(observer.getCurrentResult()).toMatchObject({
        status: 'pending',
        fetchStatus: 'idle',
        data: undefined,
      })

      unsubscribe()
    })

    test('should not be re-fetched when invalidated with refetchType: all', async () => {
      const unsubscribe = observer.subscribe(vi.fn())

      queryClient.invalidateQueries({ queryKey: key, refetchType: 'all' })

      // So we still expect it to not have fetched and not be fetching
      expect(count).toBe(0)
      expect(observer.getCurrentResult()).toMatchObject({
        status: 'pending',
        fetchStatus: 'idle',
        data: undefined,
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(count).toBe(0)

      unsubscribe()
    })

    test('should still trigger a fetch when refetch is called', async () => {
      const unsubscribe = observer.subscribe(vi.fn())

      expect(enabled).toBe(false)

      // Not the same with explicit refetch, this will override enabled and trigger a fetch anyway
      observer.refetch()

      expect(observer.getCurrentResult()).toMatchObject({
        status: 'pending',
        fetchStatus: 'fetching',
        data: undefined,
      })

      await vi.advanceTimersByTimeAsync(10)
      expect(count).toBe(1)
      expect(observer.getCurrentResult()).toMatchObject({
        status: 'success',
        fetchStatus: 'idle',
        data: 'data',
      })

      unsubscribe()
    })

    test('should fetch if unsubscribed, then enabled returns true, and then re-subscribed', async () => {
      let unsubscribe = observer.subscribe(vi.fn())
      expect(observer.getCurrentResult()).toMatchObject({
        status: 'pending',
        fetchStatus: 'idle',
        data: undefined,
      })

      unsubscribe()

      enabled = true

      unsubscribe = observer.subscribe(vi.fn())

      expect(observer.getCurrentResult()).toMatchObject({
        status: 'pending',
        fetchStatus: 'fetching',
        data: undefined,
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(count).toBe(1)

      unsubscribe()
    })

    test('should not be re-fetched if not subscribed to after enabled was toggled to true (fetchStatus: "idle")', () => {
      const unsubscribe = observer.subscribe(vi.fn())

      // Toggle enabled
      enabled = true

      unsubscribe()

      queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' })

      expect(observer.getCurrentResult()).toMatchObject({
        status: 'pending',
        fetchStatus: 'idle',
        data: undefined,
      })
      expect(count).toBe(0)
    })

    test('should not be re-fetched if not subscribed to after enabled was toggled to true (fetchStatus: "fetching")', async () => {
      const unsubscribe = observer.subscribe(vi.fn())

      // Toggle enabled
      enabled = true

      queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' })

      expect(observer.getCurrentResult()).toMatchObject({
        status: 'pending',
        fetchStatus: 'fetching',
        data: undefined,
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(count).toBe(1)

      unsubscribe()
    })

    test('should handle that the enabled callback updates the return value', async () => {
      const unsubscribe = observer.subscribe(vi.fn())

      // Toggle enabled
      enabled = true

      queryClient.invalidateQueries({ queryKey: key, refetchType: 'inactive' })

      // should not refetch since it was active and we only refetch inactive
      await vi.advanceTimersByTimeAsync(10)
      expect(count).toBe(0)

      queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' })

      // should refetch since it was active and we refetch active
      await vi.advanceTimersByTimeAsync(10)
      expect(count).toBe(1)

      // Toggle enabled
      enabled = false

      // should not refetch since it is not active and we only refetch active
      queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' })

      await vi.advanceTimersByTimeAsync(10)
      expect(count).toBe(1)

      unsubscribe()
    })
  })

  test('should be able to read latest data when re-subscribing (but not re-fetching)', async () => {
    const key = queryKey()
    let count = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        await sleep(10)
        count++
        return 'data'
      },
    })

    let unsubscribe = observer.subscribe(vi.fn())

    // unsubscribe before data comes in
    unsubscribe()
    expect(count).toBe(0)
    expect(observer.getCurrentResult()).toMatchObject({
      status: 'pending',
      fetchStatus: 'fetching',
      data: undefined,
    })

    await vi.advanceTimersByTimeAsync(10)
    expect(count).toBe(1)

    // re-subscribe after data comes in
    unsubscribe = observer.subscribe(vi.fn())

    expect(observer.getCurrentResult()).toMatchObject({
      status: 'success',
      data: 'data',
    })

    unsubscribe()
  })

  test('should notify when switching query', async () => {
    const key1 = queryKey()
    const key2 = queryKey()
    const results: Array<QueryObserverResult> = []
    const observer = new QueryObserver(queryClient, {
      queryKey: key1,
      queryFn: () => 1,
    })
    const unsubscribe = observer.subscribe((result) => {
      results.push(result)
    })
    await vi.advanceTimersByTimeAsync(0)
    observer.setOptions({ queryKey: key2, queryFn: () => 2 })
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    expect(results.length).toBe(4)
    expect(results[0]).toMatchObject({ data: undefined, status: 'pending' })
    expect(results[1]).toMatchObject({ data: 1, status: 'success' })
    expect(results[2]).toMatchObject({ data: undefined, status: 'pending' })
    expect(results[3]).toMatchObject({ data: 2, status: 'success' })
  })

  test('should be able to fetch with a selector', async () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => ({ count: 1 }),
      select: (data) => ({ myCount: data.count }),
    })
    let observerResult
    const unsubscribe = observer.subscribe((result) => {
      expectTypeOf(result).toEqualTypeOf<
        QueryObserverResult<{ myCount: number }>
      >()
      observerResult = result
    })
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    expect(observerResult).toMatchObject({ data: { myCount: 1 } })
  })

  test('should be able to fetch with a selector using the fetch method', async () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => ({ count: 1 }),
      select: (data) => ({ myCount: data.count }),
    })
    const observerResult = await observer.refetch()
    expectTypeOf(observerResult.data).toEqualTypeOf<
      { myCount: number } | undefined
    >()
    expect(observerResult.data).toMatchObject({ myCount: 1 })
  })

  test('should be able to fetch with a selector and object syntax', async () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => ({ count: 1 }),
      select: (data) => ({ myCount: data.count }),
    })
    let observerResult
    const unsubscribe = observer.subscribe((result) => {
      observerResult = result
    })
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    expect(observerResult).toMatchObject({ data: { myCount: 1 } })
  })

  test('should run the selector again if the data changed', async () => {
    const key = queryKey()
    let count = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => ({ count }),
      select: (data) => {
        count++
        return { myCount: data.count }
      },
    })
    const observerResult1 = await observer.refetch()
    const observerResult2 = await observer.refetch()
    expect(count).toBe(2)
    expect(observerResult1.data).toMatchObject({ myCount: 0 })
    expect(observerResult2.data).toMatchObject({ myCount: 1 })
  })

  test('should run the selector again if the selector changed', async () => {
    const key = queryKey()
    let count = 0
    const results: Array<QueryObserverResult> = []
    const queryFn = () => ({ count: 1 })
    const select1 = (data: ReturnType<typeof queryFn>) => {
      count++
      return { myCount: data.count }
    }
    const select2 = (_data: ReturnType<typeof queryFn>) => {
      count++
      return { myCount: 99 }
    }
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      select: select1,
    })
    const unsubscribe = observer.subscribe((result) => {
      results.push(result)
    })
    await vi.advanceTimersByTimeAsync(0)
    observer.setOptions({
      queryKey: key,
      queryFn,
      select: select2,
    })
    await observer.refetch()
    unsubscribe()
    expect(count).toBe(2)
    expect(results.length).toBe(5)
    expect(results[0]).toMatchObject({
      status: 'pending',
      isFetching: true,
      data: undefined,
    })
    expect(results[1]).toMatchObject({
      status: 'success',
      isFetching: false,
      data: { myCount: 1 },
    })
    expect(results[2]).toMatchObject({
      status: 'success',
      isFetching: false,
      data: { myCount: 99 },
    })
    expect(results[3]).toMatchObject({
      status: 'success',
      isFetching: true,
      data: { myCount: 99 },
    })
    expect(results[4]).toMatchObject({
      status: 'success',
      isFetching: false,
      data: { myCount: 99 },
    })
  })

  test('should not run the selector again if the data and selector did not change', async () => {
    const key = queryKey()
    let count = 0
    const results: Array<QueryObserverResult> = []
    const queryFn = () => ({ count: 1 })
    const select = (data: ReturnType<typeof queryFn>) => {
      count++
      return { myCount: data.count }
    }
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      select,
    })
    const unsubscribe = observer.subscribe((result) => {
      results.push(result)
    })
    await vi.advanceTimersByTimeAsync(0)
    observer.setOptions({
      queryKey: key,
      queryFn,
      select,
    })
    await observer.refetch()
    unsubscribe()
    expect(count).toBe(1)
    expect(results.length).toBe(4)
    expect(results[0]).toMatchObject({
      status: 'pending',
      isFetching: true,
      data: undefined,
    })
    expect(results[1]).toMatchObject({
      status: 'success',
      isFetching: false,
      data: { myCount: 1 },
    })
    expect(results[2]).toMatchObject({
      status: 'success',
      isFetching: true,
      data: { myCount: 1 },
    })
    expect(results[3]).toMatchObject({
      status: 'success',
      isFetching: false,
      data: { myCount: 1 },
    })
  })

  test('should not run the selector again if the data did not change', async () => {
    const key = queryKey()
    let count = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => ({ count: 1 }),
      select: (data) => {
        count++
        return { myCount: data.count }
      },
    })
    const observerResult1 = await observer.refetch()
    const observerResult2 = await observer.refetch()
    expect(count).toBe(1)
    expect(observerResult1.data).toMatchObject({ myCount: 1 })
    expect(observerResult2.data).toMatchObject({ myCount: 1 })
  })

  test('should always run the selector again if selector throws an error and selector is not referentially stable', async () => {
    const key = queryKey()
    const results: Array<QueryObserverResult> = []
    const queryFn = async () => {
      await sleep(10)
      return { count: 1 }
    }
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      select: () => {
        throw new Error('selector error')
      },
    })
    const unsubscribe = observer.subscribe((result) => {
      results.push(result)
    })
    await vi.advanceTimersByTimeAsync(10)
    observer.refetch()
    await vi.advanceTimersByTimeAsync(10)
    unsubscribe()
    expect(results[0]).toMatchObject({
      status: 'pending',
      isFetching: true,
      data: undefined,
    })
    expect(results[1]).toMatchObject({
      status: 'error',
      isFetching: false,
      data: undefined,
    })
    expect(results[2]).toMatchObject({
      status: 'error',
      isFetching: true,
      data: undefined,
    })
    expect(results[3]).toMatchObject({
      status: 'error',
      isFetching: false,
      data: undefined,
    })
  })

  test('should return stale data if selector throws an error', async () => {
    const key = queryKey()
    const results: Array<QueryObserverResult> = []
    let shouldError = false
    const error = new Error('select error')
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      retry: 0,
      queryFn: async () => {
        await sleep(10)
        return shouldError ? 2 : 1
      },
      select: (num) => {
        if (shouldError) {
          throw error
        }
        shouldError = true
        return String(num)
      },
    })

    const unsubscribe = observer.subscribe((result) => {
      results.push(result)
    })
    await vi.advanceTimersByTimeAsync(10)
    observer.refetch()
    await vi.advanceTimersByTimeAsync(10)
    unsubscribe()

    expect(results[0]).toMatchObject({
      status: 'pending',
      isFetching: true,
      data: undefined,
      error: null,
    })
    expect(results[1]).toMatchObject({
      status: 'success',
      isFetching: false,
      data: '1',
      error: null,
    })
    expect(results[2]).toMatchObject({
      status: 'success',
      isFetching: true,
      data: '1',
      error: null,
    })
    expect(results[3]).toMatchObject({
      status: 'error',
      isFetching: false,
      data: '1',
      error,
    })
  })

  test('should structurally share the selector', async () => {
    const key = queryKey()
    let count = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => ({ count: ++count }),
      select: () => ({ myCount: 1 }),
    })
    const observerResult1 = await observer.refetch()
    const observerResult2 = await observer.refetch()
    expect(count).toBe(2)
    expect(observerResult1.data).toBe(observerResult2.data)
  })

  test('should not trigger a fetch when subscribed and disabled', async () => {
    const key = queryKey()
    const queryFn = vi
      .fn<(...args: Array<unknown>) => string>()
      .mockReturnValue('data')
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      enabled: false,
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    expect(queryFn).toHaveBeenCalledTimes(0)
  })

  test('should not trigger a fetch when subscribed and disabled by callback', async () => {
    const key = queryKey()
    const queryFn = vi
      .fn<(...args: Array<unknown>) => string>()
      .mockReturnValue('data')
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      enabled: () => false,
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    expect(queryFn).toHaveBeenCalledTimes(0)
  })

  test('should not trigger a fetch when not subscribed', async () => {
    const key = queryKey()
    const queryFn = vi
      .fn<(...args: Array<unknown>) => string>()
      .mockReturnValue('data')
    new QueryObserver(queryClient, { queryKey: key, queryFn })
    await vi.advanceTimersByTimeAsync(0)
    expect(queryFn).toHaveBeenCalledTimes(0)
  })

  test('should be able to watch a query without defining a query function', async () => {
    const key = queryKey()
    const queryFn = vi
      .fn<(...args: Array<unknown>) => string>()
      .mockReturnValue('data')
    const callback = vi.fn()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      enabled: false,
    })
    const unsubscribe = observer.subscribe(callback)
    await queryClient.fetchQuery({ queryKey: key, queryFn })
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  test('should accept unresolved query config in update function', async () => {
    const key = queryKey()
    const queryFn = vi
      .fn<(...args: Array<unknown>) => string>()
      .mockReturnValue('data')
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      enabled: false,
    })
    const results: Array<QueryObserverResult<unknown>> = []
    const unsubscribe = observer.subscribe((x) => {
      results.push(x)
    })
    observer.setOptions({ queryKey: key, enabled: false, staleTime: 10 })
    await queryClient.fetchQuery({ queryKey: key, queryFn })
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(results.length).toBe(2)
    expect(results[0]).toMatchObject({ isStale: false, data: undefined })
    expect(results[1]).toMatchObject({ isStale: false, data: 'data' })
  })

  test('should be able to handle multiple subscribers', async () => {
    const key = queryKey()
    const queryFn = vi
      .fn<(...args: Array<unknown>) => string>()
      .mockReturnValue('data')
    const observer = new QueryObserver<string>(queryClient, {
      queryKey: key,
      enabled: false,
    })
    const results1: Array<QueryObserverResult<string>> = []
    const results2: Array<QueryObserverResult<string>> = []
    const unsubscribe1 = observer.subscribe((x) => {
      results1.push(x)
    })
    const unsubscribe2 = observer.subscribe((x) => {
      results2.push(x)
    })
    await queryClient.fetchQuery({ queryKey: key, queryFn })
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe1()
    unsubscribe2()
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(results1.length).toBe(2)
    expect(results2.length).toBe(2)
    expect(results1[0]).toMatchObject({ data: undefined })
    expect(results1[1]).toMatchObject({ data: 'data' })
    expect(results2[0]).toMatchObject({ data: undefined })
    expect(results2[1]).toMatchObject({ data: 'data' })
  })

  test('should stop retry when unsubscribing', async () => {
    const key = queryKey()
    let count = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => {
        count++
        return Promise.reject<unknown>('reject')
      },
      retry: 10,
      retryDelay: 50,
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(50)
    unsubscribe()
    await vi.advanceTimersByTimeAsync(50)
    expect(count).toBe(2)
  })

  test('should clear interval when unsubscribing to a refetchInterval query', async () => {
    const key = queryKey()
    let count = 0

    const fetchData = () => {
      count++
      return Promise.resolve('data')
    }
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: fetchData,
      gcTime: 0,
      refetchInterval: 10,
    })
    const unsubscribe = observer.subscribe(() => undefined)
    expect(count).toBe(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(count).toBe(2)
    unsubscribe()
    await vi.advanceTimersByTimeAsync(10)
    expect(queryClient.getQueryCache().find({ queryKey: key })).toBeUndefined()
    expect(count).toBe(2)
  })

  test('uses placeholderData as non-cache data when pending a query with no data', async () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => 'data',
      placeholderData: 'placeholder',
    })

    expect(observer.getCurrentResult()).toMatchObject({
      status: 'success',
      data: 'placeholder',
    })

    const results: Array<QueryObserverResult<unknown>> = []

    const unsubscribe = observer.subscribe((x) => {
      results.push(x)
    })

    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()

    expect(results.length).toBe(2)
    expect(results[0]).toMatchObject({ status: 'success', data: 'placeholder' })
    expect(results[1]).toMatchObject({ status: 'success', data: 'data' })
  })

  test('should structurally share placeholder data', () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      enabled: false,
      queryFn: () => 'data',
      placeholderData: {},
    })

    const firstData = observer.getCurrentResult().data

    observer.setOptions({ queryKey: key, placeholderData: {} })

    const secondData = observer.getCurrentResult().data

    expect(firstData).toBe(secondData)
  })

  test('should throw an error if enabled option type is not valid', () => {
    const key = queryKey()

    expect(
      () =>
        new QueryObserver(queryClient, {
          queryKey: key,
          queryFn: () => 'data',
          // @ts-expect-error
          enabled: null,
        }),
    ).toThrowError('Expected enabled to be a boolean')
  })

  test('getCurrentQuery should return the current query', () => {
    const key = queryKey()

    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => 'data',
    })

    expect(observer.getCurrentQuery().queryKey).toEqual(key)
  })

  test('should throw an error if throwOnError option is true', async () => {
    const key = queryKey()

    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => Promise.reject<unknown>('error'),
      retry: false,
    })

    let error: string | null = null
    try {
      await observer.refetch({ throwOnError: true })
    } catch (err) {
      error = err as string
    }

    expect(error).toEqual('error')
  })

  test('should not refetch in background if refetchIntervalInBackground is false', async () => {
    const key = queryKey()
    const queryFn = vi
      .fn<(...args: Array<unknown>) => string>()
      .mockReturnValue('data')

    focusManager.setFocused(false)
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      refetchIntervalInBackground: false,
      refetchInterval: 10,
    })

    const unsubscribe = observer.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(30)

    expect(queryFn).toHaveBeenCalledTimes(1)

    // Clean-up
    unsubscribe()
    focusManager.setFocused(true)
  })

  test('should not use replaceEqualDeep for select value when structuralSharing option is true', async () => {
    const key = queryKey()

    const data = { value: 'data' }
    const selectedData = { value: 'data' }

    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => data,
      select: () => data,
    })

    const unsubscribe = observer.subscribe(() => undefined)

    await vi.advanceTimersByTimeAsync(0)
    expect(observer.getCurrentResult().data).toBe(data)

    observer.setOptions({
      queryKey: key,
      queryFn: () => data,
      structuralSharing: false,
      select: () => selectedData,
    })

    await observer.refetch()
    expect(observer.getCurrentResult().data).toBe(selectedData)

    unsubscribe()
  })

  test('should not use replaceEqualDeep for select value when structuralSharing option is true and placeholderData is defined', () => {
    const key = queryKey()

    const data = { value: 'data' }
    const selectedData1 = { value: 'data' }
    const selectedData2 = { value: 'data' }
    const placeholderData1 = { value: 'data' }
    const placeholderData2 = { value: 'data' }

    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => data,
      select: () => data,
    })

    observer.setOptions({
      queryKey: key,
      queryFn: () => data,
      select: () => {
        return selectedData1
      },
      placeholderData: placeholderData1,
    })

    observer.setOptions({
      queryKey: key,
      queryFn: () => data,
      select: () => {
        return selectedData2
      },
      placeholderData: placeholderData2,
      structuralSharing: false,
    })

    expect(observer.getCurrentResult().data).toBe(selectedData2)
  })

  test('should pass the correct previous queryKey (from prevQuery) to placeholderData function params with select', async () => {
    const results: Array<QueryObserverResult> = []
    const keys: Array<ReadonlyArray<unknown> | null> = []

    const key1 = queryKey()
    const key2 = queryKey()

    const data1 = { value: 'data1' }
    const data2 = { value: 'data2' }

    const observer = new QueryObserver(queryClient, {
      queryKey: key1,
      queryFn: () => data1,
      placeholderData: (prev, prevQuery) => {
        keys.push(prevQuery?.queryKey || null)
        return prev
      },
      select: (data) => data.value,
    })

    const unsubscribe = observer.subscribe((result) => {
      results.push(result)
    })

    await vi.advanceTimersByTimeAsync(0)

    observer.setOptions({
      queryKey: key2,
      queryFn: () => data2,
      placeholderData: (prev, prevQuery) => {
        keys.push(prevQuery?.queryKey || null)
        return prev
      },
      select: (data) => data.value,
    })

    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    expect(results.length).toBe(4)
    expect(keys.length).toBe(3)
    expect(keys[0]).toBe(null) // First Query - status: 'pending', fetchStatus: 'idle'
    expect(keys[1]).toBe(null) // First Query - status: 'pending', fetchStatus: 'fetching'
    expect(keys[2]).toBe(key1) // Second Query - status: 'pending', fetchStatus: 'fetching'

    expect(results[0]).toMatchObject({
      data: undefined,
      status: 'pending',
      fetchStatus: 'fetching',
    }) // Initial fetch
    expect(results[1]).toMatchObject({
      data: 'data1',
      status: 'success',
      fetchStatus: 'idle',
    }) // Successful fetch
    expect(results[2]).toMatchObject({
      data: 'data1',
      status: 'success',
      fetchStatus: 'fetching',
    }) // Fetch for new key, but using previous data as placeholder
    expect(results[3]).toMatchObject({
      data: 'data2',
      status: 'success',
      fetchStatus: 'idle',
    }) // Successful fetch for new key
  })

  test('should pass the correct previous data to placeholderData function params when select function is used in conjunction', async () => {
    const results: Array<QueryObserverResult> = []

    const key1 = queryKey()
    const key2 = queryKey()

    const data1 = { value: 'data1' }
    const data2 = { value: 'data2' }

    let selectCount = 0

    const observer = new QueryObserver(queryClient, {
      queryKey: key1,
      queryFn: () => data1,
      placeholderData: (prev) => prev,
      select: (data) => {
        selectCount++
        return data.value
      },
    })

    const unsubscribe = observer.subscribe((result) => {
      results.push(result)
    })

    await vi.advanceTimersByTimeAsync(0)

    observer.setOptions({
      queryKey: key2,
      queryFn: () => data2,
      placeholderData: (prev) => prev,
      select: (data) => {
        selectCount++
        return data.value
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()

    expect(results.length).toBe(4)
    expect(results[0]).toMatchObject({
      data: undefined,
      status: 'pending',
      fetchStatus: 'fetching',
    }) // Initial fetch
    expect(results[1]).toMatchObject({
      data: 'data1',
      status: 'success',
      fetchStatus: 'idle',
    }) // Successful fetch
    expect(results[2]).toMatchObject({
      data: 'data1',
      status: 'success',
      fetchStatus: 'fetching',
    }) // Fetch for new key, but using previous data as placeholder
    expect(results[3]).toMatchObject({
      data: 'data2',
      status: 'success',
      fetchStatus: 'idle',
    }) // Successful fetch for new key

    // it's 3 because select is an inline function
    expect(selectCount).toBe(3)
  })

  test('should use cached selectResult when switching between queries and placeholderData returns previousData', async () => {
    const results: Array<QueryObserverResult> = []

    const key1 = queryKey()
    const key2 = queryKey()

    const data1 = { value: 'data1' }
    const data2 = { value: 'data2' }

    const stableSelect = vi.fn((data: { value: string }) => data.value)

    const observer = new QueryObserver(queryClient, {
      queryKey: key1,
      queryFn: () => data1,
      placeholderData: (prev) => prev,
      select: stableSelect,
    })

    const unsubscribe = observer.subscribe((result) => {
      results.push(result)
    })

    await vi.advanceTimersByTimeAsync(0)

    observer.setOptions({
      queryKey: key2,
      queryFn: () => data2,
      placeholderData: (prev) => prev,
      select: stableSelect,
    })

    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()

    expect(results.length).toBe(4)
    expect(results[0]).toMatchObject({
      data: undefined,
      status: 'pending',
      fetchStatus: 'fetching',
    }) // Initial fetch
    expect(results[1]).toMatchObject({
      data: 'data1',
      status: 'success',
      fetchStatus: 'idle',
    }) // Successful fetch
    expect(results[2]).toMatchObject({
      data: 'data1',
      status: 'success',
      fetchStatus: 'fetching',
    }) // Fetch for new key, but using previous data as placeholder
    expect(results[3]).toMatchObject({
      data: 'data2',
      status: 'success',
      fetchStatus: 'idle',
    }) // Successful fetch for new key

    expect(stableSelect).toHaveBeenCalledTimes(2)
    expect(stableSelect.mock.calls[0]![0]).toEqual(data1)
    expect(stableSelect.mock.calls[1]![0]).toEqual(data2)
  })

  test('setOptions should notify cache listeners', () => {
    const key = queryKey()

    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      enabled: false,
    })

    const spy = vi.fn()
    const unsubscribe = queryClient.getQueryCache().subscribe(spy)
    observer.setOptions({ queryKey: key, enabled: false, refetchInterval: 10 })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'observerOptionsUpdated' }),
    )

    unsubscribe()
  })

  test('disabled observers should not be stale', () => {
    const key = queryKey()

    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      enabled: false,
    })

    const result = observer.getCurrentResult()
    expect(result.isStale).toBe(false)
  })

  test('should allow staleTime as a function', async () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: async () => {
        await sleep(5)
        return {
          data: 'data',
          staleTime: 20,
        }
      },
      staleTime: (query) => query.state.data?.staleTime ?? 0,
    })
    const results: Array<QueryObserverResult<unknown>> = []
    const unsubscribe = observer.subscribe((x) => {
      if (x.data) {
        results.push(x)
      }
    })

    await vi.advanceTimersByTimeAsync(25)
    expect(results[0]?.isStale).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(results[1]?.isStale).toBe(true)

    unsubscribe()
  })

  test('should not see queries as stale is staleTime is Static', async () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: async () => {
        await sleep(5)
        return {
          data: 'data',
        }
      },
      staleTime: 'static',
    })
    const result = observer.getCurrentResult()
    expect(result.isStale).toBe(true) // no data = stale

    const results: Array<QueryObserverResult<unknown>> = []
    const unsubscribe = observer.subscribe((x) => {
      if (x.data) {
        results.push(x)
      }
    })

    await vi.advanceTimersByTimeAsync(5)
    expect(results[0]?.isStale).toBe(false)

    unsubscribe()
  })

  test('should return a promise that resolves when data is present', async () => {
    const results: Array<QueryObserverResult> = []
    const key = queryKey()
    let count = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => {
        if (++count > 9) {
          return Promise.resolve('data')
        }
        throw new Error('rejected')
      },
      retry: 10,
      retryDelay: 0,
    })
    const unsubscribe = observer.subscribe(() => {
      results.push(observer.getCurrentResult())
    })

    await vi.advanceTimersByTimeAsync(8)
    expect(results.at(-1)?.data).toBe('data')

    const numberOfUniquePromises = new Set(
      results.map((result) => result.promise),
    ).size
    expect(numberOfUniquePromises).toBe(1)

    unsubscribe()
  })

  test('should return a new promise after recovering from an error', async () => {
    const results: Array<QueryObserverResult> = []
    const key = queryKey()

    let succeeds = false
    let idx = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => {
        if (succeeds) {
          return Promise.resolve('data')
        }
        throw new Error(`rejected #${++idx}`)
      },
      retry: 5,
      retryDelay: 0,
    })
    const unsubscribe = observer.subscribe(() => {
      results.push(observer.getCurrentResult())
    })

    await vi.advanceTimersByTimeAsync(4)
    expect(results.at(-1)?.status).toBe('error')

    expect(
      results.every((result) => result.promise === results[0]!.promise),
    ).toBe(true)

    {
      // fail again
      const lengthBefore = results.length
      observer.refetch()
      await vi.advanceTimersByTimeAsync(4)
      expect(results.length).toBeGreaterThan(lengthBefore)
      expect(results.at(-1)?.status).toBe('error')

      const numberOfUniquePromises = new Set(
        results.map((result) => result.promise),
      ).size

      expect(numberOfUniquePromises).toBe(2)
    }
    {
      // succeed
      succeeds = true
      observer.refetch()

      await vi.advanceTimersByTimeAsync(0)
      results.at(-1)?.status === 'success'

      const numberOfUniquePromises = new Set(
        results.map((result) => result.promise),
      ).size

      expect(numberOfUniquePromises).toBe(3)
    }

    unsubscribe()
  })

  test('shouldFetchOnWindowFocus should respect refetchOnWindowFocus option', () => {
    const key = queryKey()

    const observer1 = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => 'data',
      refetchOnWindowFocus: true,
    })
    expect(observer1.shouldFetchOnWindowFocus()).toBe(true)

    const observer2 = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => 'data',
      refetchOnWindowFocus: false,
    })
    expect(observer2.shouldFetchOnWindowFocus()).toBe(false)
  })

  test('fetchOptimistic should fetch and return optimistic result', async () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => 'data',
    })

    const result = await observer.fetchOptimistic({
      queryKey: key,
      queryFn: () => 'data',
    })

    expect(result.status).toBe('success')
    expect(result.data).toBe('data')
  })

  test('should track error prop when throwOnError is true', async () => {
    const key = queryKey()
    const results: Array<QueryObserverResult> = []
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => Promise.reject('error'),
      retry: false,
      throwOnError: true,
    })

    const trackedResult = observer.trackResult(
      observer.getCurrentResult(),
      (prop) => {
        if (prop === 'data' || prop === 'status') {
          observer.trackProp(prop)
        }
      },
    )

    trackedResult.data
    trackedResult.status

    const unsubscribe = observer.subscribe((result) => {
      results.push(result)
    })

    await vi.advanceTimersByTimeAsync(0)
    const lastResult = results[results.length - 1]
    expect(lastResult?.status).toBe('error')

    expect(results.length).toBe(1)
    expect(results[0]).toMatchObject({
      status: 'error',
      error: 'error',
    })

    unsubscribe()
  })

  test('should not refetchOnMount when set to "always" when staleTime is Static', async () => {
    const key = queryKey()
    const queryFn = vi.fn(() => 'data')
    queryClient.setQueryData(key, 'initial')
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      staleTime: 'static',
      refetchOnMount: 'always',
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(queryFn).toHaveBeenCalledTimes(0)
    unsubscribe()
  })

  test('should set fetchStatus to idle when _optimisticResults is isRestoring', () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => 'data',
      _optimisticResults: 'isRestoring',
    })

    const result = observer.getCurrentResult()
    expect(result.fetchStatus).toBe('idle')
  })

  test('should return isEnabled depending on enabled being resolved', () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => 'data',
      enabled: () => false,
    })

    const result = observer.getCurrentResult()
    expect(result.isEnabled).toBe(false)
  })

  test('should return isEnabled as true per default', () => {
    const key = queryKey()
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => 'data',
    })

    const result = observer.getCurrentResult()
    expect(result.isEnabled).toBe(true)
  })
})
