import path from 'node:path';
export function uploadDirectory() {
  if (process.env.NODE_ENV === 'production' && !process.env.UPLOAD_DIR)
    throw new Error('UPLOAD_STORAGE_NOT_CONFIGURED');
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), '.uploads');
}
