import { v2 as cloudinary } from 'cloudinary'
import { AppError } from '../utils/errors'

let configured = false

function ensureConfigured() {
  if (configured) return
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new AppError(503, 'Attachment upload is temporarily unavailable. Please contact your administrator.')
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  })
  configured = true
}

export async function uploadAttachment(
  buffer: Buffer,
  originalName: string
): Promise<string> {
  ensureConfigured()

  const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_')
  const publicId = `bloom-lms/attachments/${Date.now()}-${safeName}`

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ public_id: publicId, resource_type: 'auto' }, (error, result) => {
        if (error || !result) {
          reject(new AppError(500, 'File upload failed'))
        } else {
          resolve(result.secure_url)
        }
      })
      .end(buffer)
  })
}

export async function deleteAttachment(url: string) {
  ensureConfigured()
  // Extract public_id from URL
  const match = url.match(/\/bloom-lms\/attachments\/[^.]+/)
  if (match) {
    await cloudinary.uploader.destroy(match[0]!.slice(1)) // remove leading /
  }
}
