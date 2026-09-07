/**
 * Accessible modal / slide-over built on Radix Dialog.
 * Focus trapping, escape-to-close and scroll locking come from Radix; the
 * styling gives the same create/edit interaction used across the Sed* products.
 *
 * On small screens the panel docks to the bottom of the viewport so it stays
 * reachable one-handed; from `sm` up it is a centred dialog.
 */
import { useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { TESTIDS } from '@shared/testIds.js';
import { cn } from '../../lib/utils.js';
import { pushBackHandler } from '../../lib/backHandler.js';
import Button from './Button.jsx';

const WIDTHS = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  testId,
  closeOnOverlay = true,
}) {
  /*
   * Radix closes on Escape, but Android's back gesture is not Escape — without
   * this, back would navigate away and leave the dialog's work unfinished.
   */
  useEffect(() => {
    if (!open) return undefined;
    return pushBackHandler(() => onOpenChange?.(false));
  }, [open, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-canvas-deep/75 backdrop-blur-[3px]" />

        <Dialog.Content
          data-testid={testId || TESTIDS.common.modal}
          onInteractOutside={(event) => {
            if (!closeOnOverlay) event.preventDefault();
          }}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-panel border border-white/[0.10] bg-canvas-raised/90 shadow-panel backdrop-blur-heavy',
            'animate-panel-in focus:outline-none sm:animate-modal-in',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card',
            WIDTHS[size] ?? WIDTHS.md
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
            <div className="min-w-0">
              <Dialog.Title
                data-testid={TESTIDS.common.modalTitle}
                className="font-display text-lg font-semibold tracking-tight text-slate-900"
              >
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-slate-500">
                  {description}
                </Dialog.Description>
              ) : (
                // Radix warns without a description; keep one for screen readers.
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                data-testid={TESTIDS.common.modalClose}
                aria-label="Close dialog"
                className="-mr-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>

          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-white/[0.08] px-6 py-5 sm:flex-row sm:justify-end">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Yes/no confirmation, used for destructive or irreversible actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  loading = false,
  variant = 'danger',
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      testId={TESTIDS.common.confirmDialog}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            data-testid={TESTIDS.common.modalCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            loading={loading}
            data-testid={TESTIDS.common.modalConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}

export default Modal;
