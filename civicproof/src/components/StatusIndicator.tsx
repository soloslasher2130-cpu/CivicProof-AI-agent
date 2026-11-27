import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  ImageOff,
  Send,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { ComplaintPriority, ComplaintStatus, StatusHistoryItem } from '../types';
import { formatDateTime } from '../lib/api';

const STATUS_META: Record<
  ComplaintStatus,
  { colorClass: string; icon: typeof Clock; label: string }
> = {
  Submitted: { colorClass: 'text-slate-700', icon: Clock, label: 'Submitted' },
  Forwarded: { colorClass: 'text-blue-700', icon: Send, label: 'Forwarded' },
  'Under Review': { colorClass: 'text-amber-700', icon: Eye, label: 'Under Review' },
  'In Progress': { colorClass: 'text-indigo-700', icon: Wrench, label: 'In Progress' },
  Resolved: { colorClass: 'text-emerald-700', icon: CheckCircle2, label: 'Resolved' },
  Rejected: { colorClass: 'text-red-700', icon: XCircle, label: 'Rejected' },
};

export function StatusLabel({ status }: { status: ComplaintStatus }) {
  const meta = STATUS_META[status] || STATUS_META.Submitted;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${meta.colorClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

const PRIORITY_META: Record<ComplaintPriority, string> = {
  Low: 'text-slate-600',
  Medium: 'text-blue-700',
  High: 'text-amber-700',
  Urgent: 'text-red-700 font-semibold',
};

export function PriorityLabel({ priority }: { priority: ComplaintPriority }) {
  const color = PRIORITY_META[priority] || PRIORITY_META.Medium;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${color}`}>
      {priority === 'Urgent' && <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      <span>{priority} Priority</span>
    </span>
  );
}

const PIPELINE_STEPS: ComplaintStatus[] = [
  'Submitted',
  'Forwarded',
  'Under Review',
  'In Progress',
  'Resolved',
];

export function ComplaintProgressTimeline({
  currentStatus,
  history,
}: {
  currentStatus: ComplaintStatus;
  history: StatusHistoryItem[];
}) {
  const isRejected = currentStatus === 'Rejected';
  const activeIndex = isRejected ? -1 : PIPELINE_STEPS.indexOf(currentStatus);

  return (
    <div className="space-y-6">
      {/* Visual 5-step horizontal progress rail */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-slate-900">Resolution Progress</h4>
          <StatusLabel status={currentStatus} />
        </div>

        {isRejected ? (
          <div className="p-4 bg-red-50/70 border border-red-200 rounded-lg text-sm text-red-900">
            <p className="font-semibold">Complaint Closed as Rejected</p>
            <p className="text-xs text-red-800 mt-1">
              Review the administrative note in the status history below for the reason and recommended next step.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {PIPELINE_STEPS.map((step, index) => {
              const completed = index < activeIndex;
              const current = index === activeIndex;
              return (
                <div key={step} className="space-y-2">
                  <div
                    className={`h-1.5 rounded-full transition-colors ${
                      completed
                        ? 'bg-emerald-600'
                        : current
                        ? 'bg-blue-700'
                        : 'bg-slate-200'
                    }`}
                  />
                  <div className="flex items-center gap-1">
                    <span
                      className={`text-xs leading-tight ${
                        current
                          ? 'font-semibold text-blue-900'
                          : completed
                          ? 'font-medium text-emerald-800'
                          : 'text-slate-400'
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Immutable Status Audit Trail */}
      <div>
        <h4 className="text-sm font-semibold text-slate-900 mb-3">Status History Log</h4>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No status history entries recorded yet.</p>
        ) : (
          <ol className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
            {history.map((item) => (
              <li key={item.id} className="p-3.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    {item.previous_status ? (
                      <>
                        <span className="font-medium text-slate-500">{item.previous_status}</span>
                        <span aria-hidden="true">→</span>
                        <StatusLabel status={item.new_status} />
                      </>
                    ) : (
                      <StatusLabel status={item.new_status} />
                    )}
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {formatDateTime(item.created_at)}
                  </span>
                </div>
                <p className="text-slate-800 mt-1.5 leading-relaxed">{item.note}</p>
                <p className="text-xs text-slate-500 mt-1">Recorded by {item.updated_by_name}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function ResilientImage({
  src,
  alt,
  className = 'w-full h-48 object-cover rounded-lg',
  fallbackLabel = 'Civic issue photograph',
}: {
  src?: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-100 border border-slate-200 text-slate-500 text-xs gap-1.5 ${className}`}
      >
        <ImageOff className="w-5 h-5 text-slate-400" aria-hidden="true" />
        <span>{fallbackLabel}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-xl">
        <h3 id="confirm-dialog-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h3>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{message}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              destructive
                ? 'bg-red-700 hover:bg-red-800'
                : 'bg-[#0F2D5C] hover:bg-blue-900'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CivicLogoMark({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg
        width="26"
        height="26"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          width="28"
          height="28"
          rx="6"
          fill={light ? '#FFFFFF' : '#0F2D5C'}
        />
        <path
          d="M14 5.5L21 8.5V14.2C21 18.4 17.9 21.8 14 23C10.1 21.8 7 18.4 7 14.2V8.5L14 5.5Z"
          stroke={light ? '#0F2D5C' : '#FFFFFF'}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M10.8 14.2L13 16.4L17.4 12"
          stroke={light ? '#1D4ED8' : '#93C5FD'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`font-display text-lg font-bold tracking-tight ${
          light ? 'text-white' : 'text-[#0F2D5C]'
        }`}
      >
        CivicProof
      </span>
    </span>
  );
}
