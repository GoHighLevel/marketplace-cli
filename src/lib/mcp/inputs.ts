import path from 'node:path'

import { z } from 'zod'

import { isAppResourceIdentifier } from '../app/schema.js'
import { CodedError } from '../shared/errors.js'

const MAX_PATH_LENGTH = 1024

/* The server's working directory is wherever the client started it, so
   file-system inputs must be absolute. */
export function absolutePath() {
  return z.string().trim().min(1).max(MAX_PATH_LENGTH).refine(path.isAbsolute, 'Use an absolute path.')
}

export function appId() {
  return z.string().trim().refine(isAppResourceIdentifier, 'Use an appId from get-account.')
}

/* An argument that one action of a multi-action tool needs. */
export function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === '') throw new CodedError('INVALID_INPUT', message)
  return value
}
