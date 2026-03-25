import type { RelayConfig, RelayEnvelope } from './types'
import { consola } from 'consola'
import { PartySocket } from 'partysocket'

const log = consola.withTag('relay')

const MAX_SEEN_EVENT_IDS = 100

export class RelayTransport {
  private socket: PartySocket | null = null
  private readonly url: string
  private readonly room: string
  private readonly token: string | null
  private readonly triggerRefresh: () => void
  private readonly seenEventIds = new Set<string>()

  constructor(config: RelayConfig, triggerRefresh: () => void) {
    if (!config.url)
      throw new Error('relay.url is required when polling.mode is relay')
    if (!config.room)
      throw new Error('relay.room is required when polling.mode is relay')

    this.url = config.url
    this.room = config.room
    this.token = config.token
    this.triggerRefresh = triggerRefresh
  }

  connect(): void {
    if (this.socket)
      return

    const query: Record<string, string> = {}
    if (this.token)
      query.token = this.token

    this.socket = new PartySocket({
      host: this.url,
      party: 'relay',
      room: this.room,
      query,
    })

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data)
    })

    this.socket.addEventListener('open', () => {
      log.info(`connected to relay url=${this.url} room=${this.room}`)
    })

    this.socket.addEventListener('close', () => {
      log.warn(`relay connection closed — partysocket will auto-reconnect`)
    })

    this.socket.addEventListener('error', (err) => {
      log.error(`relay connection error:`, err)
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close()
      this.socket = null
      log.info('relay transport disconnected')
    }
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  private handleMessage(data: unknown): void {
    let envelope: RelayEnvelope
    try {
      envelope = JSON.parse(typeof data === 'string' ? data : String(data))
    }
    catch (e) {
      log.warn('failed to parse relay message:', e)
      return
    }

    // Deduplicate by event_id to prevent duplicate processing after reconnect
    if (envelope.event_id) {
      if (this.seenEventIds.has(envelope.event_id)) {
        log.info(`skipping duplicate event_id=${envelope.event_id}`)
        return
      }
      this.seenEventIds.add(envelope.event_id)
      // Evict oldest entries when cache exceeds limit
      if (this.seenEventIds.size > MAX_SEEN_EVENT_IDS) {
        const first = this.seenEventIds.values().next().value
        if (first)
          this.seenEventIds.delete(first)
      }
    }

    log.info(`received relay event for room=${this.room} event_id=${envelope.event_id ?? 'none'}`)
    this.triggerRefresh()
  }
}
