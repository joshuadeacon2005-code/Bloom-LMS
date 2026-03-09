export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    page?: number
    pageSize?: number
    total?: number
  }
}
