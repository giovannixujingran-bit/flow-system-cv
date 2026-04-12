"use client";

type ConfirmDialogProps = {
  title: string;
  description: string;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmTone?: "default" | "danger";
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  title,
  description,
  cancelLabel = "取消",
  confirmLabel = "确认",
  confirmTone = "default",
  pending = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={pending ? undefined : onCancel}>
      <div
        aria-describedby="confirm-dialog-description"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="dialog-panel panel stack"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
      >
        <div className="stack">
          <strong id="confirm-dialog-title">{title}</strong>
          <div className="muted" id="confirm-dialog-description">
            {description}
          </div>
        </div>
        <div className="dialog-actions">
          <button className="button button-inline dialog-button" disabled={pending} onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button
            className={
              confirmTone === "danger"
                ? "button button-inline button-danger-subtle dialog-button"
                : "button button-inline dialog-button"
            }
            disabled={pending}
            onClick={() => void onConfirm()}
            type="button"
          >
            {pending ? "处理中..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
