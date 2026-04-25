import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach access token on every request; clear Content-Type for FormData
api.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }
  const stored = localStorage.getItem('bloom-lms-auth')
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { state?: { accessToken?: string } }
      const token = parsed.state?.accessToken
      if (token) config.headers.Authorization = `Bearer ${token}`
    } catch {
      // Ignore parse errors
    }
  }
  return config
})

// On 401, attempt refresh then retry once
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as typeof error.config & { _retry?: boolean }
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        const stored = localStorage.getItem('bloom-lms-auth')
        const refreshToken = stored
          ? (JSON.parse(stored) as { state?: { refreshToken?: string } }).state?.refreshToken
          : null

        if (!refreshToken) throw new Error('No refresh token')

        const { data } = await axios.post<{
          data: { accessToken: string; refreshToken: string }
        }>('/api/auth/refresh', { refreshToken })

        // Update stored tokens
        const existing = localStorage.getItem('bloom-lms-auth')
        if (existing) {
          const parsed = JSON.parse(existing) as { state: Record<string, unknown> }
          parsed.state.accessToken = data.data.accessToken
          parsed.state.refreshToken = data.data.refreshToken
          localStorage.setItem('bloom-lms-auth', JSON.stringify(parsed))
        }

        original.headers.Authorization = `Bearer ${data.data.accessToken}`
        return api(original)
      } catch {
        localStorage.removeItem('bloom-lms-auth')
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
