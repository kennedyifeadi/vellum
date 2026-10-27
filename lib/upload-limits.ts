import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';
import { BYTES_PER_MB, HEADLINE_LIMITS, TOOL_IDS, TOOL_LIMITS, ToolId, ToolLimits, isToolId } from '@/lib/tool-limits';

// What the upload screen checks before sending anything, so a file the server would
// refuse is turned away before it is uploaded. The server still decides.

export interface SizedFile {
  name: string;
  size: number;
}

export interface Admission<T> {
  files: T[];
  /** The first reason a file was turned away, if any was. */
  error: string | null;
}

const SINGLE_FILE_MESSAGE = 'This tool only supports processing 1 file at a time.';

/** The plan as the pricing page names it; a guest is on Free. */
export function planName(plan: string | null | undefined): string {
  return resolvePlanLimit(plan, { guest: 'Free', Basic: 'Basic', Pro: 'Pro', Enterprise: 'Enterprise' });
}

function formatMb(bytes: number): string {
  return `${bytes / BYTES_PER_MB} MB`;
}

/** The largest upload any tool takes on this plan, for files added before a tool is chosen. */
export function largestUploadBytes(plan: string | null | undefined): number {
  return Math.max(...TOOL_IDS.map((tool) => resolvePlanLimit(plan, TOOL_LIMITS[tool].maxBytes)));
}

export function uploadLimitLabel(toolId: string, plan: string | null | undefined): string {
  if (!isToolId(toolId)) return 'Limits depend on the tool you choose';

  const limits: ToolLimits = TOOL_LIMITS[toolId];
  const size = formatMb(resolvePlanLimit(plan, limits.maxBytes));
  const prefix = `${planName(plan)} plan: up to`;
  if (limits.sizeApplies === 'request') {
    return `${prefix} ${resolvePlanLimit(plan, limits.maxFiles)} files, ${size} in total`;
  }
  const pages = limits.maxPages ? ` and ${resolvePlanLimit(plan, limits.maxPages)} pages` : '';
  return `${prefix} ${size}${pages} per file`;
}

/**
 * Adds `incoming` to `current` as far as the tool's limits on this plan allow. A file
 * that is too large on its own is skipped; once the count or the total would be passed,
 * nothing more is added. A file already in the list is skipped without an error.
 */
export function admitFiles<T extends SizedFile>(
  current: T[],
  incoming: T[],
  toolId: string,
  toolName: string,
  plan: string | null | undefined,
): Admission<T> {
  const files = [...current];
  let error: string | null = null;
  const refuse = (message: string) => {
    error ??= message;
  };
  const plansName = planName(plan);

  if (!isToolId(toolId)) {
    const maxBytes = largestUploadBytes(plan);
    for (const file of incoming) {
      if (file.size > maxBytes) {
        refuse(`"${file.name}" is larger than any tool allows on the ${plansName} plan (${formatMb(maxBytes)}).`);
      } else if (!files.some((f) => f.name === file.name && f.size === file.size)) {
        files.push(file);
      }
    }
    return { files, error };
  }

  const limits = TOOL_LIMITS[toolId];
  const maxBytes = resolvePlanLimit(plan, limits.maxBytes);
  const maxFiles = resolvePlanLimit(plan, limits.maxFiles);

  for (const file of incoming) {
    if (limits.sizeApplies === 'file' && file.size > maxBytes) {
      refuse(`"${file.name}" is larger than ${toolName} allows on the ${plansName} plan (${formatMb(maxBytes)} per file).`);
      continue;
    }
    if (files.length >= maxFiles) {
      refuse(maxFiles === 1 ? SINGLE_FILE_MESSAGE : `${toolName} takes up to ${maxFiles} files on the ${plansName} plan.`);
      break;
    }
    if (files.some((f) => f.name === file.name && f.size === file.size)) continue;

    const total = files.reduce((sum, f) => sum + f.size, 0) + file.size;
    if (limits.sizeApplies === 'request' && total > maxBytes) {
      refuse(`These files are larger in total than ${toolName} allows on the ${plansName} plan (${formatMb(maxBytes)} in total).`);
      break;
    }
    files.push(file);
  }
  return { files, error };
}

/** Why the files chosen so far cannot be sent to this tool, or null when they can. */
export function selectionError(
  files: SizedFile[],
  toolId: string,
  toolName: string,
  plan: string | null | undefined,
): string | null {
  return admitFiles([], files, toolId, toolName, plan).error;
}

export type PlanTier = keyof PlanTierValues<number>;

export const PLAN_TIERS: PlanTier[] = ['guest', 'Basic', 'Pro', 'Enterprise'];

/** One cell of Help's limits table: what `toolId` takes on `tier`. */
export function toolLimitSummary(toolId: ToolId, tier: PlanTier): string {
  const limits: ToolLimits = TOOL_LIMITS[toolId];
  const size = formatMb(limits.maxBytes[tier]);
  const parts = limits.sizeApplies === 'request' ? [`${size} in total`, `${limits.maxFiles[tier]} files`] : [size];
  if (limits.maxPages) parts.push(`${limits.maxPages[tier].toLocaleString('en-US')} pages`);
  if (limits.maxLines) parts.push(`${limits.maxLines[tier].toLocaleString('en-US')} lines of text`);
  if (limits.maxMegapixelsPerImage) parts.push(`${limits.maxMegapixelsPerImage} megapixels per image`);
  if (limits.maxVideoMinutes) parts.push(`up to ${limits.maxVideoMinutes[tier]} minutes`);
  return parts.join(', ');
}

/** Help's answer to "what is the maximum file size", from the same values. */
export function maxFileSizeAnswer(): string {
  const [free, basic, pro, enterprise] = PLAN_TIERS.map((tier) => planHeadlines(tier).documentMb);
  const toWordFree = formatMb(TOOL_LIMITS['pdf-to-docx'].maxBytes.guest);
  return (
    `Most tools take files up to ${free} MB on Free, ${basic} MB on Basic, ${pro} MB on Pro and ` +
    `${enterprise} MB on Enterprise. Some tools allow less, such as PDF to DOCX (${toWordFree} on Free), ` +
    'and videos have their own caps. See "Upload limits by tool" on this page for every tool.'
  );
}

export const LIMITS_VARY_NOTE = 'Limits vary by tool — see Help for details.';

/** The simple per-plan figures pricing shows; individual tools may allow less. */
export function planHeadlines(tier: PlanTier) {
  return {
    documentMb: HEADLINE_LIMITS.documents[tier] / BYTES_PER_MB,
    videoMb: HEADLINE_LIMITS.video[tier] / BYTES_PER_MB,
    batchFiles: HEADLINE_LIMITS.batchFiles[tier],
    pdfSearchPages: HEADLINE_LIMITS.pdfSearchPages[tier],
  };
}

export function headlineFeatures(tier: PlanTier): string[] {
  const { documentMb, videoMb, batchFiles, pdfSearchPages } = planHeadlines(tier);
  return [
    `${documentMb}MB Max File Size (${videoMb}MB Video)`,
    `${batchFiles} Files per Batch Conversion`,
    `${pdfSearchPages} Pages for PDF Search`,
  ];
}

/** The dashboard's drop zone takes documents and images, whose largest cap is the general one. */
export function dropZoneMaxBytes(plan: string | null | undefined): number {
  return resolvePlanLimit(plan, HEADLINE_LIMITS.documents);
}

export function dropZoneLabel(plan: string | null | undefined): string {
  return `Max file size ${formatMb(dropZoneMaxBytes(plan))} on the ${planName(plan)} plan; some tools allow less.`;
}

export function dropZoneRefusal(fileName: string, plan: string | null | undefined): string {
  return `"${fileName}" is larger than the ${formatMb(dropZoneMaxBytes(plan))} the ${planName(plan)} plan allows for documents and images.`;
}
