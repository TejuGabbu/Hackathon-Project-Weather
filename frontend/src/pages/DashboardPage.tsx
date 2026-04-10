import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { AlertTriangle, BadgeCheck, CloudRain, Leaf, SendHorizonal, Siren } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'

import { ask, fetchAlerts, seedDemo, sendFeedback, type Alert } from '../lib/api'

function scoreColor(score: number) {
  if (score >= 0.8) return '#fb7185' // rose-400
  if (score >= 0.6) return '#f59e0b' // amber-500
  return '#22d3ee' // cyan-400
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function formatTs(ts: string) {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

export function DashboardPage() {
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null)
  const [nlq, setNlq] = useState('What needs attention right now?')

  const alertsQ = useQuery({
    queryKey: ['alerts'],
    queryFn: fetchAlerts,
    refetchInterval: 12_000,
  })

  const seedM = useMutation({
    mutationFn: seedDemo,
    onSuccess: () => alertsQ.refetch(),
  })

  const askM = useMutation({
    mutationFn: (q: string) => ask(q),
  })

  const feedbackM = useMutation({
    mutationFn: sendFeedback,
    onSuccess: () => alertsQ.refetch(),
  })

  const alerts = alertsQ.data?.alerts ?? []

  const selectedAlert = useMemo(() => {
    if (!selectedAlertId) return alerts[0] ?? null
    return alerts.find((a) => a.alert_id === selectedAlertId) ?? alerts[0] ?? null
  }, [alerts, selectedAlertId])

  const mapCenter = useMemo(() => {
    const a = selectedAlert ?? alerts[0]
    if (!a) return { lat: 7.8731, lon: 80.7718 } // Sri Lanka default
    return a.location
  }, [alerts, selectedAlert])

  const riskSeries = useMemo(() => {
    // lightweight “trend” view: rank order mapped to a line
    return alerts.slice(0, 12).map((a, i) => ({
      name: `#${i + 1}`,
      priority: clamp01(a.priority),
      confidence: clamp01(a.confidence),
      severity: clamp01(a.severity),
    }))
  }, [alerts])

  const topSignals = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of alerts.slice(0, 30)) {
      for (const s of a.signals) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [alerts])

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                <Siren className="h-4 w-4 text-cyan-300" />
                AI-Powered Environmental Sentinel
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Detect, prioritize, and explain environmental anomalies
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-white/65">
                Multi-source signals • Spatio-temporal modeling • Self-learning thresholds • NL insights • Signal convergence alerting
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => seedM.mutate()}
                className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200 shadow-sm shadow-cyan-500/10 hover:bg-cyan-400/15 active:scale-[0.99]"
                disabled={seedM.isPending}
              >
                {seedM.isPending ? 'Seeding…' : 'Seed demo data'}
              </button>
              <button
                onClick={() => alertsQ.refetch()}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 active:scale-[0.99]"
              >
                Refresh
              </button>
            </div>
          </header>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <section className="lg:col-span-7">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-rose-300" />
                    <div className="text-sm font-medium text-white">Geospatial anomaly map</div>
                  </div>
                  <div className="text-xs text-white/60">Click markers for explanations</div>
                </div>

                <div className="mt-4 h-[420px] overflow-hidden rounded-2xl border border-white/10">
                  <MapContainer center={[mapCenter.lat, mapCenter.lon]} zoom={7} scrollWheelZoom className="h-full w-full">
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {alerts.map((a) => (
                      <CircleMarker
                        key={a.alert_id}
                        center={[a.location.lat, a.location.lon]}
                        radius={Math.max(6, 6 + 18 * a.priority)}
                        pathOptions={{
                          color: scoreColor(a.priority),
                          fillColor: scoreColor(a.priority),
                          fillOpacity: 0.65,
                          weight: a.alert_id === selectedAlert?.alert_id ? 3 : 1,
                        }}
                        eventHandlers={{
                          click: () => setSelectedAlertId(a.alert_id),
                        }}
                      >
                        <Popup>
                          <div className="text-sm">
                            <div className="font-semibold">{a.headline}</div>
                            <div className="mt-1 text-xs opacity-80">{formatTs(a.timestamp)}</div>
                            <div className="mt-2 text-xs">
                              priority <b>{a.priority.toFixed(2)}</b> • confidence <b>{a.confidence.toFixed(2)}</b> • severity{' '}
                              <b>{a.severity.toFixed(2)}</b>
                            </div>
                            <div className="mt-2 text-xs opacity-90">{a.explanation.reason}</div>
                          </div>
                        </Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>
              </div>
            </section>

            <aside className="lg:col-span-5">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-white">Prioritized alerts</div>
                  <div className="text-xs text-white/60">{alertsQ.isFetching ? 'updating…' : `${alerts.length} shown`}</div>
                </div>

                <div className="mt-4 space-y-2">
                  {alerts.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                      No alerts yet. Click <b>Seed demo data</b> to generate multi-signal anomalies.
                    </div>
                  ) : (
                    alerts.slice(0, 8).map((a) => (
                      <button
                        key={a.alert_id}
                        onClick={() => setSelectedAlertId(a.alert_id)}
                        className={[
                          'w-full rounded-xl border p-3 text-left transition',
                          a.alert_id === selectedAlert?.alert_id
                            ? 'border-cyan-400/30 bg-cyan-400/10'
                            : 'border-white/10 bg-white/5 hover:bg-white/10',
                        ].join(' ')}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">{a.headline}</div>
                            <div className="mt-1 text-xs text-white/60">{formatTs(a.timestamp)}</div>
                          </div>
                          <div className="text-right text-xs text-white/70">
                            <div>
                              <span className="text-white/50">prio</span> <b>{a.priority.toFixed(2)}</b>
                            </div>
                            <div>
                              <span className="text-white/50">conf</span> <b>{a.confidence.toFixed(2)}</b>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {a.signals.slice(0, 4).map((s) => (
                            <span key={s} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                              {s}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </aside>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <section className="lg:col-span-7">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="h-5 w-5 text-cyan-200" />
                    <div className="text-sm font-medium text-white">Explainability & feedback loop</div>
                  </div>
                  <div className="text-xs text-white/60">Mark alerts to self-tune thresholds</div>
                </div>

                {!selectedAlert ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                    Select an alert to see details.
                  </div>
                ) : (
                  <AlertDetails alert={selectedAlert} onFeedback={feedbackM.mutate} isSending={feedbackM.isPending} />
                )}
              </div>
            </section>

            <section className="lg:col-span-5">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2">
                  <Leaf className="h-5 w-5 text-emerald-200" />
                  <div className="text-sm font-medium text-white">Temporal risk snapshot</div>
                </div>
                <div className="mt-3 h-[220px] rounded-xl border border-white/10 bg-white/5 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={riskSeries}>
                      <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                      <YAxis domain={[0, 1]} tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          background: 'rgba(10, 11, 16, 0.95)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 12,
                          color: 'white',
                        }}
                      />
                      <Line type="monotone" dataKey="priority" stroke="#22d3ee" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="confidence" stroke="#a855f7" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="severity" stroke="#fb7185" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">
                    priority (cyan)
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">
                    confidence (violet)
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">
                    severity (rose)
                  </span>
                </div>

                <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <CloudRain className="h-4 w-4 text-white/70" />
                    <div className="text-sm font-medium text-white">Top signals (by alert presence)</div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {topSignals.length === 0 ? (
                      <div className="text-sm text-white/70">No alerts yet.</div>
                    ) : (
                      topSignals.map(([sig, c]) => (
                        <div key={sig} className="flex items-center justify-between text-sm text-white/80">
                          <span className="font-medium">{sig}</span>
                          <span className="text-white/60">{c}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-medium text-white">Context-aware query interface</div>
                <div className="mt-1 text-xs text-white/60">Ask questions; get ranked, explainable insights (not raw data).</div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  askM.mutate(nlq)
                }}
                className="flex w-full max-w-2xl items-center gap-2"
              >
                <input
                  value={nlq}
                  onChange={(e) => setNlq(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-white/35 focus:border-cyan-400/40 focus:outline-none"
                  placeholder="Ask: “Which region is most at risk?”"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
                  disabled={askM.isPending}
                >
                  <SendHorizonal className="h-4 w-4" />
                  {askM.isPending ? 'Asking…' : 'Ask'}
                </button>
              </form>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {(askM.data?.insights ?? []).length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                  Tip: click <b>Seed demo data</b>, then ask “What needs attention right now?”
                </div>
              ) : (
                askM.data!.insights.map((ins) => (
                  <div key={ins.title} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-semibold text-white">{ins.title}</div>
                    <ul className="mt-2 space-y-1 text-sm text-white/75">
                      {ins.bullets.map((b, idx) => (
                        <li key={idx} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300/70" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                    {ins.related_alert_ids.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {ins.related_alert_ids.slice(0, 6).map((id) => (
                          <button
                            key={id}
                            onClick={() => setSelectedAlertId(id)}
                            className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function AlertDetails({
  alert,
  onFeedback,
  isSending,
}: {
  alert: Alert
  onFeedback: (p: {
    alert_id: string
    region_id: string
    signal: string
    timestamp: string
    label: 'true_positive' | 'false_positive' | 'investigating'
    notes?: string
  }) => void
  isSending: boolean
}) {
  const primarySignal = alert.signals[0] ?? 'unknown'

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-semibold text-white">{alert.headline}</div>
          <div className="mt-1 text-xs text-white/60">
            region <b>{alert.region_id}</b> • {formatTs(alert.timestamp)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Pill label={`priority ${alert.priority.toFixed(2)}`} tone="cyan" />
          <Pill label={`confidence ${alert.confidence.toFixed(2)}`} tone="violet" />
          <Pill label={`severity ${alert.severity.toFixed(2)}`} tone="rose" />
        </div>
      </div>

      <div className="mt-4 text-sm text-white/80">{alert.explanation.reason}</div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs font-medium text-white/70">Supporting signals</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {alert.explanation.supporting_signals.slice(0, 8).map((s) => (
              <span key={s} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs font-medium text-white/70">Baseline (rolling window)</div>
          <div className="mt-2 text-sm text-white/80">
            {alert.explanation.baseline ? (
              <>
                mean <b>{alert.explanation.baseline.mean.toFixed(3)}</b> • std <b>{alert.explanation.baseline.std.toFixed(3)}</b>
              </>
            ) : (
              <span className="text-white/60">Not enough history yet.</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-white/60">
          Feedback tunes region thresholds to suppress false positives over time.
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() =>
              onFeedback({
                alert_id: alert.alert_id,
                region_id: alert.region_id,
                signal: primarySignal,
                timestamp: alert.timestamp,
                label: 'true_positive',
              })
            }
            disabled={isSending}
            className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-400/15"
          >
            True positive
          </button>
          <button
            onClick={() =>
              onFeedback({
                alert_id: alert.alert_id,
                region_id: alert.region_id,
                signal: primarySignal,
                timestamp: alert.timestamp,
                label: 'investigating',
              })
            }
            disabled={isSending}
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/15"
          >
            Investigating
          </button>
          <button
            onClick={() =>
              onFeedback({
                alert_id: alert.alert_id,
                region_id: alert.region_id,
                signal: primarySignal,
                timestamp: alert.timestamp,
                label: 'false_positive',
              })
            }
            disabled={isSending}
            className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-400/15"
          >
            False positive
          </button>
        </div>
      </div>
    </div>
  )
}

function Pill({ label, tone }: { label: string; tone: 'cyan' | 'violet' | 'rose' }) {
  const klass =
    tone === 'cyan'
      ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200'
      : tone === 'violet'
        ? 'border-violet-400/25 bg-violet-400/10 text-violet-200'
        : 'border-rose-400/25 bg-rose-400/10 text-rose-200'
  return <span className={`rounded-full border px-2 py-1 ${klass}`}>{label}</span>
}

