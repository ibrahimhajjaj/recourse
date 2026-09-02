/**
 * No test reaches the network.
 *
 * The widget takes a relative endpoint, which is how anybody would configure
 * it, and happy-dom resolves a relative URL against its own document origin:
 * `http://localhost:3000`. So a test that mounts with `/api/chat` and does not
 * stub fetch does not fail, it makes a real request to port 3000 on whatever
 * machine is running the suite. In CI nothing is listening and the refusal is
 * printed and ignored. On a developer's laptop something usually is, and it
 * receives a POST shaped like feedback or a deletion.
 *
 * Replaced rather than merely observed, so the socket is never opened. A test
 * that needs fetch stubs it, and `vi.unstubAllGlobals` restores this rather
 * than the real one, because this is what was in place when the stub was made.
 */
beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input : input.url)

    throw new Error(
      `this test reached the network for ${url}. Stub fetch with vi.stubGlobal, ` +
        'or assert on what the widget did rather than on what a server would say.',
    )
  }) as typeof fetch
})
