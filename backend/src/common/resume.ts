import { mkdirSync } from 'fs';
import path from 'path';

/** 简历文件存放目录（相对后端运行目录） */
export const RESUME_DIR = path.join(process.cwd(), 'uploads', 'resumes');

export const RESUME_EXTENSIONS = ['.pdf', '.doc', '.docx'];

export const RESUME_MAX_SIZE = 5 * 1024 * 1024;

export function ensureResumeDir() {
  mkdirSync(RESUME_DIR, { recursive: true });
}

export function resumeAbsolutePath(fileName: string) {
  return path.join(RESUME_DIR, fileName);
}

/** multipart 文件名按 latin1 解码时会出现乱码，此处尝试还原为 UTF-8 */
export function decodeUploadFilename(name: string) {
  if (!name) return '';
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? name : decoded;
  } catch {
    return name;
  }
}
