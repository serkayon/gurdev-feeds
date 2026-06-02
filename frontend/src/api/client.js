// Centralized API client, auth session helpers, and endpoint wrappers.
import axios from 'axios'

const configuredApiUrl = String(import.meta.env.VITE_API_URL || '')
  .trim()
  .replace(/\/+$/, '')

if (!configuredApiUrl) {
  throw new Error('VITE_API_URL is required (example: http://localhost:8007)')
}

const apiOrigin = configuredApiUrl
const apiBaseUrl = apiOrigin.toLowerCase().endsWith('/api') ? apiOrigin : `${apiOrigin}/api`

const client = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
})
// Encode a dynamic URL segment safely.
const encodePathParam = (value) => encodeURIComponent(String(value ?? ''))
const AUTH_TOKEN_STORAGE_KEY = 'poultry_auth_token'
const AUTH_USER_STORAGE_KEY = 'poultry_auth_user'

// Read a value from localStorage in browser-safe form.
const getStoredValue = (key) => {
  if (typeof window === 'undefined') return ''
  return String(window.localStorage.getItem(key) || '')
}

const decodeJwtPayload = (token) => {
  const rawToken = String(token || '').trim()
  if (!rawToken) return null
  const parts = rawToken.split('.')
  if (parts.length < 2) return null
  const payloadPart = String(parts[1] || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = payloadPart.padEnd(payloadPart.length + ((4 - (payloadPart.length % 4)) % 4), '=')
  try {
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return JSON.parse(window.atob(padded))
    }
    return null
  } catch {
    return null
  }
}

const getTokenExpiryMs = (token) => {
  const payload = decodeJwtPayload(token)
  const exp = Number(payload?.exp || 0)
  if (!Number.isFinite(exp) || exp <= 0) return 0
  return exp * 1000
}

export const isAuthTokenValid = (token) => {
  const rawToken = String(token || '').trim()
  if (!rawToken) return false
  const expiryMs = getTokenExpiryMs(rawToken)
  if (!expiryMs) return false
  return Date.now() < expiryMs
}

const purgeInvalidAuthSession = () => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY)
}

export const getAuthToken = () => {
  const token = getStoredValue(AUTH_TOKEN_STORAGE_KEY)
  if (!isAuthTokenValid(token)) {
    purgeInvalidAuthSession()
    return ''
  }
  return token
}

export const getAuthTokenExpiryMs = () => {
  const token = getAuthToken()
  if (!token) return 0
  return getTokenExpiryMs(token)
}

export const getAuthUser = () => {
  if (!getAuthToken()) return null
  const raw = getStoredValue(AUTH_USER_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const setAuthSession = (token, user = null) => {
  if (typeof window === 'undefined') return
  const normalizedToken = String(token || '').trim()
  if (normalizedToken) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, normalizedToken)
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  }

  if (user && typeof user === 'object') {
    window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user))
  } else {
    window.localStorage.removeItem(AUTH_USER_STORAGE_KEY)
  }
}

export const clearAuthSession = () => {
  purgeInvalidAuthSession()
}

let backendReachable = true
const backendStatusListeners = new Set()

// Notify all backend reachability subscribers.
const notifyBackendStatus = () => {
  backendStatusListeners.forEach((listener) => {
    try {
      listener(backendReachable)
    } catch {
      // Ignore listener errors so one bad subscriber does not break others.
    }
  })
}

// Update the cached backend reachability state.
const setBackendReachable = (isReachable) => {
  if (backendReachable === isReachable) return
  backendReachable = isReachable
  notifyBackendStatus()
}

// Extract a normalized text payload from an HTTP error.
const collectErrorText = (error) => {
  const parts = []
  const message = String(error?.message || '').trim()
  if (message) parts.push(message)

  const responseData = error?.response?.data
  if (typeof responseData === 'string' && responseData.trim()) {
    parts.push(responseData)
  } else if (responseData && typeof responseData === 'object') {
    const detail = responseData.detail || responseData.message || responseData.error
    if (typeof detail === 'string' && detail.trim()) {
      parts.push(detail)
    }
  }
  return parts.join(' ').toLowerCase()
}

// Classify errors that indicate the backend is unreachable.
const isBackendOfflineError = (error) => {
  if (!error?.response) return true

  const status = Number(error.response.status || 0)
  if (status >= 500) return true

  const code = String(error?.code || '').toLowerCase()
  if (code.includes('network') || code.includes('conn') || code.includes('abort')) {
    return true
  }

  const text = collectErrorText(error)
  if (
    text.includes('econnrefused') ||
    text.includes('connect econnrefused') ||
    text.includes('http proxy error') ||
    text.includes('proxy error')
  ) {
    return true
  }

  return false
}

// True when a 401 comes from PIN verification/change endpoints.
const isPinAuthRequest = (error) => {
  const requestUrl = String(error?.config?.url || '').toLowerCase()
  return requestUrl.includes('/auth/pin/verify') || requestUrl.includes('/auth/pin/change')
}

client.interceptors.response.use(
  (response) => {
    setBackendReachable(true)
    return response
  },
  (error) => {
    setBackendReachable(!isBackendOfflineError(error))
    if (Number(error?.response?.status || 0) === 401 && !isPinAuthRequest(error)) {
      clearAuthSession()
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/layout')) {
        window.location.replace('/')
      }
    }
    return Promise.reject(error)
  }
)// it is the response interceptor, it will return the response as is, and in case of error it will reject the promise with the error

client.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export default client

export const backendStatus = {
  // Inspect the cached health state.
  get: () => backendReachable,
  // Subscribe to health-state changes.
  subscribe: (listener) => {
    if (typeof listener !== 'function') return () => {}
    backendStatusListeners.add(listener)
    listener(backendReachable)
    return () => {
      backendStatusListeners.delete(listener)
    }
  },
  // Ping the backend health endpoint.
  ping: async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await fetch(`${apiBaseUrl}/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })
      const isReachable = Number(response.status || 0) < 500
      setBackendReachable(isReachable)
      return isReachable
    } catch (error) {
      setBackendReachable(false)
      return false
    } finally {
      clearTimeout(timer)
    }
  },
}

export const auth = {
  // Authentication and PIN endpoints.
  login: (email, password) => client.post('/auth/login', { email, password }),
  vendorSignup: (data) => client.post('/auth/vendor-signup', data),
  vendorCreateCustomer: (data) => client.post('/auth/vendor/customer-signup', data),
  profile: () => client.get('/auth/profile'),
  updateProfile: (data) => client.put('/auth/profile', data),
  demoVendor: () => client.post('/auth/demo/vendor'),
  demoCustomer: () => client.post('/auth/demo/customer'),
  verifyPin: (pin, pinType = 'settings') => client.post('/auth/pin/verify', { pin, pin_type: pinType }),
  changePin: (currentPin, newPin, pinType = 'settings') =>
    client.post('/auth/pin/change', { current_pin: currentPin, new_pin: newPin, pin_type: pinType }),
}


export const plc = {
  // PLC monitoring endpoints.
  latest: () => client.get('/plc/latest'),
  history: (minutes = 60, params = {}) => client.get('/plc/history', { params: { minutes, ...params } }),
  machineStatus: () => client.get('/plc/machine/status'),
}



export const rawMaterial = {
  // Raw material endpoints.
  listTypes: () => client.get('/raw-material/types'),
  addType: (name) => client.post('/raw-material/types', null, { params: { name } }),
  updateType: (id, name) => client.put(`/raw-material/types/${id}`, null, { params: { name } }),
  deleteType: (id) => client.delete(`/raw-material/types/${id}`),
  list: (params) => client.get('/raw-material', { params }),
  listByPeriod: (period, rmType = 'all', params = {}) =>
    client.get(
      `/raw-material/filtered/${encodePathParam(period)}/${encodePathParam(rmType)}`,
      { params }
    ),
  summaryByPeriod: (period, rmType = 'all', params = {}) =>
    client.get(
      `/raw-material/summary/${encodePathParam(period)}/${encodePathParam(rmType)}`,
      { params }
    ),
  create: (data) => client.post('/raw-material', data),
  update: (entryCode, data) => client.put(`/raw-material/${encodePathParam(entryCode)}`, data),
  downloadEntry: (entryCode, format = 'pdf') => client.get(`/raw-material/${encodePathParam(entryCode)}/download`, { params: { format }, responseType: 'blob' }),
  getLabReport: (entryCode) => client.get(`/raw-material/lab-report/${encodePathParam(entryCode)}`),
  submitLabReport: (data) => client.post('/raw-material/lab-report', data),
  download: (format, params = {}) =>
    client.get('/raw-material/download', {
      params: { format, ...params },
      responseType: 'blob'
    }),
}

export const dispatchApi = {
  // Dispatch entry endpoints.
  list: (params) => client.get('/dispatch', { params }),
  listByPeriod: (period, productType = 'all', params = {}) =>
    client.get(
      `/dispatch/filtered/${encodePathParam(period)}/${encodePathParam(productType)}`,
      { params }
    ),
  summaryByPeriod: (period, productType = 'all', params = {}) =>
    client.get(
      `/dispatch/summary/${encodePathParam(period)}/${encodePathParam(productType)}`,
      { params }
    ),
  create: (data) => client.post('/dispatch', data),
  update: (dispatchCode, data) => client.put(`/dispatch/${encodePathParam(dispatchCode)}`, data),
  downloadEntry: (dispatchCode, format = 'pdf') => client.get(`/dispatch/${encodePathParam(dispatchCode)}/download`, { params: { format }, responseType: 'blob' }),
  download: (format, params = {}) =>
    client.get('/dispatch/download', {
      params: { format, ...params },
      responseType: 'blob',
    }),
  downloadInvoice: (dispatchCode) => client.get(`/dispatch/${encodePathParam(dispatchCode)}/invoice`, { responseType: 'blob' }),
}

export const productionApi = {
  // Production batch endpoints.
  listBatches: (params) => client.get('/production/batches', { params }),
  listBatchesByPeriod: (period, productName = 'all', params = {}) =>
    client.get(
      `/production/batches/filtered/${encodePathParam(period)}/${encodePathParam(productName)}`,
      { params }
    ),
  summaryByPeriod: (period, productName = 'all', params = {}) =>
    client.get(
      `/production/batches/summary/${encodePathParam(period)}/${encodePathParam(productName)}`,
      { params }
    ),
  getBatch: (id) => client.get(`/production/batches/${id}`),
  markBatchCompleteEligibility: (id) =>
    client.get(`/production/batches/${id}/mark-complete-eligibility`),
  createBatch: (data) => client.post('/production/batches', data),
  updateBatchDetails: (id, data) => client.put(`/production/batches/${id}/details`, data),
  markBatchComplete: (id) => client.post(`/production/batches/${id}/mark-complete`, {}),
  submitReport: (data) => client.post('/production/report', data),
  consumptionReport: (params) => client.get('/production/consumption', { params }),
  download: (format, params = {}) =>
    client.get('/production/download', {
      params: { format, ...params },
      responseType: 'blob'
    }),

  // ✅ ADD THIS (download single batch)
  downloadBatch: (id, format = "pdf") =>
    client.get(`/production/${id}/download`, {
      params: { format },
      responseType: 'blob'
    }),
  downloadBatchConsumption: (id, format = "pdf") =>
    client.get(`/production/${id}/consumption/download`, {
      params: { format },
      responseType: 'blob'
    }),
}


 export const stockApi = {
  rm: (params) => client.get('/stock/rm', { params }),
  rmByPeriod: (period, params = {}) =>
    client.get(`/stock/rm/filtered/${encodePathParam(period)}`, { params }),
  rmSummary: () => client.get('/stock/rm/summary'),
  feed: (params) => client.get('/stock/feed', { params }),
  feedByPeriod: (period, params = {}) =>
    client.get(`/stock/feed/filtered/${encodePathParam(period)}`, { params }),
  feedSummary: () => client.get('/stock/feed/summary'),

  // ✅ Raw Material Report
  downloadRM: (format = "pdf", params = {}) =>
    client.get('/stock/download/rm', {
      params: { format, ...params },
      responseType: 'blob'
    }),
  downloadRMIndividual: (format = "pdf") =>
    client.get('/stock/download/rm-summary', {
      params: { format },
      responseType: 'blob'
    }),

  // ✅ Dispatch Report
  downloadDispatch: (format = "pdf", params = {}) =>
    client.get('/dispatch/download', {
      params: { format, ...params },
      responseType: 'blob'
    }),

  // ✅ Production Report
  downloadProduction: (format = "pdf", params = {}) =>
    client.get('/production/download', {
      params: { format, ...params },
      responseType: 'blob'
    }),

  // ✅ Finished Feed Report
  downloadFeed: (format = "pdf", params = {}) =>
    client.get('/stock/download/feed', {
      params: { format, ...params },
      responseType: 'blob'
    }),

  downloadFeedIndividual: (format = "pdf") =>
    client.get('/stock/download/feed-summary', {
      params: { format },
      responseType: 'blob'
    }),
    
  // ✅ Overall Stock (RM + Feed in single file)
  downloadOverall: (format = "pdf") =>
    client.get('/stock/download/overall', {
      params: { format },
      responseType: 'blob'
    }),
};
export const configApi = {
  productTypes: () => client.get('/config/product-types'),
  productTypesManage: () => client.get('/config/product-types/manage'),
  addProductType: (name) =>
    client.post('/config/product-types', null, { params: { name } }),
  updateProductType: (id, name) =>
    client.put(`/config/product-types/${id}`, null, { params: { name } }),
  deleteProductType: (id) => client.delete(`/config/product-types/${id}`),
  recipes: () => client.get('/config/recipes'),
  addRecipe: (data) => client.post('/config/recipes', data),
  updateRecipe: (id, data) => client.put(`/config/recipes/${id}`, data),
  deleteRecipe: (id) => client.delete(`/config/recipes/${id}`),
}
