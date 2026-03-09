import multer from 'multer'
import { AppError } from '../utils/errors'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new AppError(400, 'Only JPEG, PNG, WebP, and PDF files are allowed'))
    } else {
      cb(null, true)
    }
  },
})
