import React from 'react'
import { useEffect } from 'react'

// Shared dialog shell with Escape-key close support.
export default function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    const handle = (e) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center m-3 sm:m-2">
      <div className="fixed inset-0  bg-black/40" onClick={onClose} />
      <div className="relative bg-primary-card border border-gray-700 rounded-xl mb-20
                max-w-2xl w-full
                max-h-[calc(100vh-90px)] sm:max-h-[90vh]
                overflow-y-auto shadow-xl">
      {/* <div className="relative bg-primary-card border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"> */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-black">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-900 hover:text-black text-2xl leading-none">&times;</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
