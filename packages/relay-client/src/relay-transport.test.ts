import type { RelayConfig } from './types'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { RelayTransport } from './relay-transport'

// Capture message handlers so we can simulate incoming messages
let messageHandlers: Array<(event: { data: string }) => void> = []

const mockSocket = {
  addEventListener: mock((event: string, handler: (...args: any[]) => void) => {
    if (event === 'message')
      messageHandlers.push(handler as (event: { data: string }) => void)
  }),
  removeEventListener: mock(() => {}),
  close: mock(() => {}),
  readyState: 1, // OPEN
}

mock.module('partysocket', () => ({
  PartySocket: mock(() => mockSocket),
}))

describe('RelayTransport', () => {
  let config: RelayConfig
  let triggerRefresh: ReturnType<typeof mock>

  beforeEach(() => {
    config = {
      url: 'https://relay.example.com',
      token: 'test-token',
      room: 'test-room',
      secret: null,
    }
    triggerRefresh = mock(() => {})
    messageHandlers = []
    mockSocket.addEventListener.mockClear()
    mockSocket.close.mockClear()
  })

  afterEach(() => {
    mock.restore()
  })

  it('creates with valid config', () => {
    const transport = new RelayTransport(config, triggerRefresh)
    expect(transport).toBeDefined()
  })

  it('throws when url is null', () => {
    config.url = null
    expect(() => new RelayTransport(config, triggerRefresh)).toThrow('relay.url is required')
  })

  it('throws when room is null', () => {
    config.room = null
    expect(() => new RelayTransport(config, triggerRefresh)).toThrow('relay.room is required')
  })

  it('connect registers message handler', () => {
    const transport = new RelayTransport(config, triggerRefresh)
    transport.connect()
    expect(mockSocket.addEventListener).toHaveBeenCalled()
  })

  it('disconnect closes socket', () => {
    const transport = new RelayTransport(config, triggerRefresh)
    transport.connect()
    transport.disconnect()
    expect(mockSocket.close).toHaveBeenCalled()
  })

  it('isConnected returns false before connect', () => {
    const transport = new RelayTransport(config, triggerRefresh)
    expect(transport.isConnected()).toBe(false)
  })

  it('calls triggerRefresh on message with event_id', () => {
    const transport = new RelayTransport(config, triggerRefresh)
    transport.connect()
    expect(messageHandlers.length).toBeGreaterThan(0)
    messageHandlers[0]({ data: JSON.stringify({ type: 'webhook_event', event_id: 'abc-123' }) })
    expect(triggerRefresh).toHaveBeenCalledTimes(1)
  })

  it('deduplicates events with same event_id', () => {
    const transport = new RelayTransport(config, triggerRefresh)
    transport.connect()
    const envelope = JSON.stringify({ type: 'webhook_event', event_id: 'dup-001' })
    messageHandlers[0]({ data: envelope })
    messageHandlers[0]({ data: envelope })
    messageHandlers[0]({ data: envelope })
    expect(triggerRefresh).toHaveBeenCalledTimes(1)
  })

  it('processes events without event_id (no dedup)', () => {
    const transport = new RelayTransport(config, triggerRefresh)
    transport.connect()
    const envelope = JSON.stringify({ type: 'webhook_event' })
    messageHandlers[0]({ data: envelope })
    messageHandlers[0]({ data: envelope })
    expect(triggerRefresh).toHaveBeenCalledTimes(2)
  })

  it('handles unparseable message gracefully', () => {
    const transport = new RelayTransport(config, triggerRefresh)
    transport.connect()
    messageHandlers[0]({ data: 'not json' })
    expect(triggerRefresh).toHaveBeenCalledTimes(0)
  })
})
