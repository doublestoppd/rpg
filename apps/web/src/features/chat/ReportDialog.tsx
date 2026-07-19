import { type ChatReportReason } from '@rpg/shared';
import { useId, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { useReportChatMessage } from './useChat';

const REASONS: { value: ChatReportReason; label: string }[] = [
  { value: 'HARASSMENT', label: 'Harassment' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'ABUSIVE_LANGUAGE', label: 'Abusive language' },
  { value: 'CHEATING_OR_EXPLOITS', label: 'Cheating or exploits' },
  { value: 'OTHER', label: 'Other' },
];

interface ReportDialogProps {
  open: boolean;
  messageId: string | null;
  onClose: () => void;
  onReported: () => void;
}

export function ReportDialog({ open, messageId, onClose, onReported }: ReportDialogProps) {
  const report = useReportChatMessage();
  const [reason, setReason] = useState<ChatReportReason>('HARASSMENT');
  const [details, setDetails] = useState('');
  const reasonId = useId();
  const detailsId = useId();

  const submit = () => {
    if (!messageId) return;
    report.mutate(
      { messageId, reason, ...(details.trim() ? { details: details.trim() } : {}) },
      {
        onSuccess: () => {
          setDetails('');
          onReported();
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      title="Report message"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={report.isPending} onClick={submit}>
            Submit report
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Reports are confidential — the reported player is never told who reported them.
        </p>
        <div className="space-y-1">
          <label
            htmlFor={reasonId}
            className="block text-sm font-medium text-stone-700 dark:text-stone-300"
          >
            Reason
          </label>
          <select
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value as ChatReportReason)}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          >
            {REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label
            htmlFor={detailsId}
            className="block text-sm font-medium text-stone-700 dark:text-stone-300"
          >
            Details (optional)
          </label>
          <textarea
            id={detailsId}
            value={details}
            maxLength={500}
            rows={3}
            onChange={(event) => setDetails(event.target.value)}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          />
        </div>
        {report.isError && (
          <p role="alert" className="text-xs text-red-700">
            {report.error.message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
