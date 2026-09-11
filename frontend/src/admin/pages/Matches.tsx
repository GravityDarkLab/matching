import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchMatches, updateMatch, removeMatch } from '../api/client'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { matchStatusTone } from '../../components/ui/statusTones'
import { useStatusLabels } from '../hooks/useStatusLabels'
import { usePagedFilter } from '../hooks/usePagedFilter'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { Th, PageButton, TrashIcon } from '../components/Table'
import type { Match, MatchStatus } from '../types'

const LIMIT = 20

const STATUS_NEXT: Partial<Record<MatchStatus, MatchStatus[]>> = {
  proposed:    ['in_progress', 'declined', 'failed'],
  in_progress: ['dating', 'declined', 'failed'],
  dating:      ['success', 'failed'],
  failed:      ['proposed'],
  declined:    ['proposed'],
  expired:     ['proposed'],
}

const ALL_STATUSES: MatchStatus[] = [
  'proposed', 'in_progress', 'dating', 'success', 'failed', 'declined', 'expired',
]

function ChevronDownIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function Matches() {
  const { t } = useTranslation()
  const { success, error: toastError } = useToast()
  const { page, filterValue: status, setFilter: setStatusFilter, setPage } = usePagedFilter('status')

  const [matches, setMatches]       = useState<Match[]>([])
  const [total, setTotal]           = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading]       = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [notesMap, setNotesMap]     = useState<Record<string, string>>({})
  const [savingId, setSavingId]     = useState<string | null>(null)
  const [search, setSearch]         = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [pendingDelete, setPendingDelete] = useState<Match | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const FILTERS = [
    { value: '',            label: t('admin.matches.all') },
    { value: 'proposed',    label: t('admin.matches.proposed') },
    { value: 'in_progress', label: t('admin.matches.in_progress') },
    { value: 'dating',      label: t('admin.matches.dating') },
    { value: 'success',     label: t('admin.matches.success') },
    { value: 'failed',      label: t('admin.matches.failed') },
    { value: 'declined',    label: t('admin.matches.declined') },
    { value: 'expired',     label: t('admin.matches.expired') },
  ]

  function load() {
    setLoading(true)
    fetchMatches(page, LIMIT, status || undefined, undefined, debouncedSearch || undefined)
      .then(res => {
        setMatches(res.data)
        setTotal(res.total)
        setTotalPages(res.totalPages)
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [page, status, debouncedSearch])

  function setFilter(s: string) { setStatusFilter(s); setSearch('') }

  async function handleStatusChange(id: string, nextStatus: MatchStatus) {
    setSavingId(id)
    try {
      const updated = await updateMatch(id, { status: nextStatus })
      setMatches(ms => ms.map(m => m.id === id ? updated : m))
      success(t('admin.matches.statusUpdated'))
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('admin.matches.updateError'))
    } finally { setSavingId(null) }
  }

  async function handleSaveNotes(id: string) {
    setSavingId(id)
    try {
      const updated = await updateMatch(id, { notes: notesMap[id] ?? '' })
      setMatches(ms => ms.map(m => m.id === id ? updated : m))
      setExpandedId(null)
      success(t('admin.matches.notesSaved'))
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('admin.matches.updateError'))
    } finally { setSavingId(null) }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleteLoading(true)
    try {
      await removeMatch(pendingDelete.id)
      setMatches(ms => ms.filter(m => m.id !== pendingDelete.id))
      setTotal(n => n - 1)
      success(t('admin.matches.deleted'))
      setPendingDelete(null)
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('admin.matches.updateError'))
    } finally {
      setDeleteLoading(false)
    }
  }

  const rowProps = (m: Match) => ({
    match: m,
    expanded: expandedId === m.id,
    saving: savingId === m.id,
    notes: notesMap[m.id] ?? m.notes ?? '',
    onToggleExpand: () => {
      if (expandedId === m.id) { setExpandedId(null) }
      else { setExpandedId(m.id); setNotesMap(n => ({ ...n, [m.id]: m.notes ?? '' })) }
    },
    onNotesChange: (val: string) => setNotesMap(n => ({ ...n, [m.id]: val })),
    onSaveNotes: () => handleSaveNotes(m.id),
    onStatusChange: (s: MatchStatus) => handleStatusChange(m.id, s),
    onDelete: () => setPendingDelete(m),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">{t('admin.matches.title')}</h1>
        <p className="text-sm text-muted mt-0.5">
          {loading ? '—' : t('admin.matches.total', { count: total })}
        </p>
      </div>

      {/* Search bar */}
      <div className="relative">
        <svg className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="text"
          name="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('admin.matches.searchPlaceholder')}
          className="w-full sm:w-80 rounded-xl border border-border bg-surface ps-9 pe-4 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Status filter chips */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              status === f.value
                ? 'bg-accent text-bg'
                : 'bg-surface border border-border text-muted hover:text-primary hover:border-accent/40'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-surface border border-border rounded-2xl overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-subtle">
            <tr className="border-b border-border">
              <Th>{t('admin.matches.colCouple')}</Th>
              <Th>{t('admin.matches.colScore')}</Th>
              <Th>{t('admin.matches.colAlgorithm')}</Th>
              <Th>{t('admin.matches.colStatus')}</Th>
              <Th>{t('admin.matches.colActions')}</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3.5"><Skeleton className="h-4 w-24" /></td>
                  ))}
                </tr>
              ))
            ) : matches.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted">
                  {t('admin.matches.empty')}
                </td>
              </tr>
            ) : (
              matches.map(m => <MatchRow key={m.id} {...rowProps(m)} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 space-y-2 shadow-card">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))
        ) : matches.length === 0 ? (
          <p className="text-center text-sm text-muted py-10">{t('admin.matches.empty')}</p>
        ) : (
          matches.map(m => <MatchCard key={m.id} {...rowProps(m)} />)
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('admin.matches.delete')}
        description={t('admin.matches.deleteConfirm')}
        confirmLabel={t('admin.matches.delete')}
        cancelLabel={t('admin.matches.cancelNotes')}
        tone="danger"
        loading={deleteLoading}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{t('admin.matches.page', { current: page, total: totalPages })}</span>
          <div className="flex gap-2">
            <PageButton onClick={() => setPage(page - 1)} disabled={page <= 1}>{t('admin.matches.prev')}</PageButton>
            <PageButton onClick={() => setPage(page + 1)} disabled={page >= totalPages}>{t('admin.matches.next')}</PageButton>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared row pieces ──────────────────────────────────────────────────────────

interface RowProps {
  match: Match
  expanded: boolean
  saving: boolean
  notes: string
  onToggleExpand: () => void
  onNotesChange: (val: string) => void
  onSaveNotes: () => void
  onStatusChange: (s: MatchStatus) => void
  onDelete: () => void
}

function StatusMenu({ match, saving, onStatusChange }: Pick<RowProps, 'match' | 'saving' | 'onStatusChange'>) {
  const { STATUS_LABEL } = useStatusLabels()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function handleReposition() { setOpen(false) }
    document.addEventListener('mousedown', handleOutside)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open])

  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setCoords({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(o => !o)
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        className="cursor-pointer hover:opacity-80 transition-opacity"
      >
        <Badge tone={matchStatusTone(match.status)} size="sm">
          {STATUS_LABEL[match.status]}
          <ChevronDownIcon />
        </Badge>
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ top: coords.top, left: coords.left }}
          className="fixed z-50 bg-surface border border-border rounded-xl shadow-raised py-1 min-w-[140px]"
        >
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              role="menuitem"
              disabled={saving}
              onClick={() => { onStatusChange(s); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-bg transition-colors disabled:opacity-40 ${s === match.status ? 'font-medium text-primary' : 'text-muted'}`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

function RowActions({ match, expanded, saving, onToggleExpand, onStatusChange, onDelete }: Omit<RowProps, 'notes' | 'onNotesChange' | 'onSaveNotes'>) {
  const { t } = useTranslation()
  const { ACTION_LABEL } = useStatusLabels()
  const nextStatuses = STATUS_NEXT[match.status] ?? []

  return (
    <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto pb-0.5">
      {nextStatuses.map(s => (
        <button key={s} disabled={saving}
          onClick={() => onStatusChange(s)}
          className="px-2 py-1 rounded-lg border border-border text-xs text-muted hover:text-primary hover:bg-bg transition-colors disabled:opacity-40 whitespace-nowrap shrink-0">
          {ACTION_LABEL[s]}
        </button>
      ))}
      <button onClick={onToggleExpand}
        className="px-2 py-1 rounded-lg border border-border text-xs text-muted hover:text-primary hover:bg-bg transition-colors whitespace-nowrap shrink-0">
        {expanded ? t('admin.matches.cancelNotes') : t('admin.matches.editNotes')}
      </button>
      <button onClick={onDelete} disabled={saving}
        className="p-1.5 rounded-lg text-error hover:bg-error-light transition-colors disabled:opacity-40 shrink-0"
        title={t('admin.matches.delete')}>
        <span className="sr-only">{t('admin.matches.delete')}</span>
        <TrashIcon />
      </button>
    </div>
  )
}

function NotesEditor({ notes, saving, onNotesChange, onSaveNotes }: Pick<RowProps, 'notes' | 'saving' | 'onNotesChange' | 'onSaveNotes'>) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-2 items-end">
      <textarea
        rows={2}
        value={notes}
        onChange={e => onNotesChange(e.target.value)}
        placeholder={t('admin.matches.notesPlaceholder')}
        className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary placeholder:text-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
      <Button onClick={onSaveNotes} loading={saving} variant="primary">
        {t('admin.matches.saveNotes')}
      </Button>
    </div>
  )
}

function ScoreBar({ score, width = 'w-24' }: { score: number; width?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`${width} bg-border rounded-full h-1.5`}>
        <div className="bg-accent rounded-full h-1.5" style={{ width: `${Math.round(score * 100)}%` }} />
      </div>
      <span className="text-xs text-muted w-8 shrink-0">{Math.round(score * 100)}%</span>
    </div>
  )
}

// ── Desktop table row ──────────────────────────────────────────────────────────

function MatchRow(props: RowProps) {
  const { match, expanded } = props

  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-bg transition-colors">
        {/* Participants */}
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/admin/applicants/${match.applicantAId}`}
              className="font-semibold text-accent hover:underline truncate max-w-[140px]">
              {match.applicantAAlias}
            </Link>
            <span className="text-muted text-xs">↔</span>
            <Link to={`/admin/applicants/${match.applicantBId}`}
              className="font-semibold text-accent hover:underline truncate max-w-[140px]">
              {match.applicantBAlias}
            </Link>
          </div>
          {match.notes && (
            <p className="text-xs text-muted mt-1 truncate max-w-[240px]" title={match.notes}>
              {match.notes}
            </p>
          )}
        </td>

        {/* Score bar */}
        <td className="px-4 py-3.5">
          <ScoreBar score={match.score} />
        </td>

        {/* Algorithm */}
        <td className="px-4 py-3.5">
          <span className="text-xs font-mono text-muted">{match.algorithm}</span>
        </td>

        {/* Status badge with dropdown */}
        <td className="px-4 py-3.5">
          <StatusMenu {...props} />
        </td>

        {/* Actions */}
        <td className="px-4 py-3.5 max-w-[260px]">
          <RowActions {...props} />
        </td>
      </tr>

      {/* Inline notes editor */}
      {expanded && (
        <tr className="border-b border-border bg-bg">
          <td colSpan={5} className="px-4 py-3">
            <NotesEditor {...props} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Mobile card ────────────────────────────────────────────────────────────────

function MatchCard(props: RowProps) {
  const { match, expanded } = props

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <Link to={`/admin/applicants/${match.applicantAId}`}
            className="font-semibold text-accent hover:underline truncate text-sm">
            {match.applicantAAlias}
          </Link>
          <span className="text-muted text-xs">↔</span>
          <Link to={`/admin/applicants/${match.applicantBId}`}
            className="font-semibold text-accent hover:underline truncate text-sm">
            {match.applicantBAlias}
          </Link>
        </div>
        <StatusMenu {...props} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <ScoreBar score={match.score} width="w-28" />
        <span className="text-[11px] font-mono text-muted truncate">{match.algorithm}</span>
      </div>

      {match.notes && !expanded && (
        <p className="text-xs text-muted truncate" title={match.notes}>{match.notes}</p>
      )}

      <RowActions {...props} />

      {expanded && <NotesEditor {...props} />}
    </div>
  )
}
