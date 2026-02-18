export function getLearningGates(horizonMinutes: number): { minSetupQuality: number; minConfidence: number } {
  if (horizonMinutes <= 5) {
    return { minSetupQuality: 68, minConfidence: 62 };
  }
  if (horizonMinutes <= 10) {
    return { minSetupQuality: 64, minConfidence: 58 };
  }
  if (horizonMinutes <= 15) {
    return { minSetupQuality: 58, minConfidence: 52 };
  }
  return { minSetupQuality: 54, minConfidence: 48 };
}
