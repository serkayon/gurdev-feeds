import React from 'react'
import Modal from './Modal'

export default function PopupDialog({
  open,
  title,
  message,
  onClose,
  onConfirm,
  confirmText = 'OK',
  cancelText = 'Cancel',
  danger = false,
}) {
  const showConfirm = typeof onConfirm === 'function'

  const handleConfirm = async () => {
    if (showConfirm) {
      await onConfirm()
      return
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-slate-800 whitespace-pre-wrap">{message}</p>
        <div className="flex justify-end gap-2">
          {showConfirm && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border border-gray-400 text-black"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className={`px-4 py-2 rounded text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#245658] hover:bg-[#2d6f72]'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  )
}
