function normalizeParts(input: string): number[] {
  return input
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
}

function compareVersionStrings(left: string, right: string): number {
  const leftParts = normalizeParts(left);
  const rightParts = normalizeParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return left.localeCompare(right);
}

export function isVersionNewer(candidate: string, current: string): boolean {
  return compareVersionStrings(candidate, current) > 0;
}
