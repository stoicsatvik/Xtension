import { exposureAssessment } from "./core.js";

export function installReview(extension) {
  if (!extension || extension.type && extension.type !== "extension") return null;

  const assessment = exposureAssessment({
    permissions: extension.permissions ?? [],
    hostPermissions: extension.hostPermissions ?? []
  });

  if (assessment.level !== "high") return null;

  const reasons = assessment.reasons.length
    ? assessment.reasons.join(" · ")
    : "high capability exposure";

  return {
    severity: "high",
    kind: "install-review",
    summary: `${extension.name || "Extension"} was installed with high exposure`,
    detail: `${reasons}. This is a capability review, not a malware verdict.`,
    data: {
      permissions: [...new Set(extension.permissions ?? [])].sort(),
      hostPermissions: [...new Set(extension.hostPermissions ?? [])].sort()
    }
  };
}
