import React, { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../components/Modal'
import { auth } from '../api/client'

const PIN_RE = /^\d{4}$/

export default function usePinGate() {
  const [prompt, setPrompt] = useState({
    open: false,
    title: 'PIN Required',
    message: 'Enter 4-digit PIN.',
    pinType: 'settings',
    onSuccess: null,
    onCancel: null,
  })
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const hiddenInputRef = useRef(null)

  const reset = useCallback(() => {
    setPrompt((prev) => ({
      ...prev,
      open: false,
      onSuccess: null,
      onCancel: null,
    }))
    setPin('')
    setError('')
    setSubmitting(false)
  }, [])

  const requestPin = useCallback((onSuccess, options = {}) => {
    setPrompt({
      open: true,
      title: options.title || 'PIN Required',
      message: options.message || 'Enter 4-digit PIN.',
      pinType: options.pinType || 'settings',
      onSuccess: typeof onSuccess === 'function' ? onSuccess : null,
      onCancel: typeof options.onCancel === 'function' ? options.onCancel : null,
    })
    setPin('')
    setError('')
    setSubmitting(false)
  }, [])

  const handleCancel = useCallback(() => {
    if (submitting) return
    const onCancel = prompt.onCancel
    reset()
    if (onCancel) onCancel()
  }, [prompt.onCancel, reset, submitting])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    setError('')

    if (!PIN_RE.test(pin)) {
      setError('PIN must be exactly 4 digits.')
      return
    }

    try {
      setSubmitting(true)
      await auth.verifyPin(pin, prompt.pinType || 'settings')
      const onSuccess = prompt.onSuccess
      reset()
      if (onSuccess) {
        await onSuccess()
      }
    } catch (err) {
      setSubmitting(false)
      setError(err?.response?.data?.detail || 'Invalid PIN.')
    }
  }, [pin, prompt.onSuccess, prompt.pinType, reset])

  useEffect(() => {
    if (!prompt.open) return
    const t = setTimeout(() => hiddenInputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [prompt.open])

  const focusInput = useCallback(() => {
    hiddenInputRef.current?.focus()
  }, [])

  const pinDialog = (
    <Modal open={prompt.open} onClose={handleCancel} title={prompt.title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-700">{prompt.message}</p>
        <input
          ref={hiddenInputRef}
          type="password"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          className="sr-only"
          autoFocus
          required
        />
        <button
          type="button"
          onClick={focusInput}
          className="w-full flex justify-center gap-2"
        >
          {Array.from({ length: 4 }).map((_, index) => {
            const digit = pin[index] || ''
            const active = pin.length === index
            const filled = Boolean(digit)
            return (
              <span
                key={`pin-box-${index}`}
                className={`w-10 h-12 rounded-lg border text-lg font-semibold flex items-center justify-center tabular-nums ${
                  active ? 'border-[#245658] ring-1 ring-[#245658]' : 'border-gray-300'
                } ${filled ? 'text-slate-900' : 'text-slate-300'}`}
              >
                {digit || ''}
              </span>
            )
          })}
        </button>
        {error && (
          <div className="bg-red-100 text-red-800 px-3 py-2 rounded text-sm border border-red-300">
            {error}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg border border-gray-400 text-black"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-[#245658] text-white font-medium disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? 'Verifying...' : 'Verify PIN'}
          </button>
        </div>
      </form>
    </Modal>
  )

  return { requestPin, pinDialog }
}
