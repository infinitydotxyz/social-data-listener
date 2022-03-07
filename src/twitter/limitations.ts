import { AccessLevel } from './config';

export type Limitations = {
  [accessLevel: number]: number;
};

/**
 * X rules per stream.
 */
export const ruleLimitations: Limitations = {
  [AccessLevel.Essential]: 5,
  [AccessLevel.Elevated]: 25,
  [AccessLevel.Academic]: 1000
};

/**
 * Can build rules up to X characters in length.
 */
export const ruleLengthLimitations: Limitations = {
  [AccessLevel.Essential]: 512,
  [AccessLevel.Elevated]: 512,
  [AccessLevel.Academic]: 1024
};
