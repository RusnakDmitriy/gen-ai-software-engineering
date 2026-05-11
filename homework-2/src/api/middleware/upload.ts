import multer from 'multer';
import path from 'path';
import { env } from '../../config/env.js';
import { UnsupportedMediaError } from '../../domain/errors.js';

const ACCEPTED_MIMES = new Set([
  'text/csv',
  'application/csv',
  'application/json',
  'application/xml',
  'text/xml',
]);

const ACCEPTED_EXTENSIONS = new Set(['.csv', '.json', '.xml']);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (!ACCEPTED_MIMES.has(file.mimetype) || !ACCEPTED_EXTENSIONS.has(ext)) {
      return cb(new UnsupportedMediaError(file.mimetype, [...ACCEPTED_MIMES]));
    }

    cb(null, true);
  },
});
