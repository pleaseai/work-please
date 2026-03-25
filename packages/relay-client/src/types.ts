export interface RelayConfig {
  url: string | null
  token: string | null
  room: string | null
  secret: string | null
}

export interface RelayEnvelope {
  type: string
  event_id?: string
  event?: string
  action?: string | null
}
