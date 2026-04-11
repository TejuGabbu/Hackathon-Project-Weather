import axios from 'axios'
import { env } from './env'

export type GeoPoint = { lat: number; lon: number }

export type Alert = {
  alert_id: string
  region_id: string
  location: GeoPoint
  timestamp: string
  severity: number
  confidence: number
  priority: number
  signals: string[]
  headline: string
  explanation: { reason: string; supporting_signals: string[]; baseline?: { mean: number; std: number } | null }
}

export type AlertsResponse = { alerts: Alert[] }

export type AskResponse = {
  insights: { title: string; bullets: string[]; related_alert_ids: string[] }[]
}

const client = axios.create({
  baseURL: env.apiBaseUrl,
})

export async function seedDemo(): Promise<{ seeded: number }> {
  const { data } = await client.post('/seed')
  return data
}

export async function fetchAlerts(): Promise<AlertsResponse> {
  const { data } = await client.get('/alerts')
  return data
}

export async function ask(query: string): Promise<AskResponse> {
  const { data } = await client.post('/ask', { query })
  return data
}

export async function sendFeedback(payload: {
  alert_id: string
  region_id: string
  signal: string
  timestamp: string
  label: 'true_positive' | 'false_positive' | 'investigating'
  notes?: string
}): Promise<{ ok: boolean }> {
  const { data } = await client.post('/feedback', payload)
  return data
}

