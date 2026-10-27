import { ALL_TOOLS } from '@/lib/tools';
import { TOOL_IDS, VIDEO_LENGTH_NOTE } from '@/lib/tool-limits';
import { PLAN_TIERS, planName, toolLimitSummary } from '@/lib/upload-limits';

export default function ToolLimitsTable() {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto bg-white border border-[#eaedf3] rounded-2xl">
        <table className="w-full min-w-160 text-left text-[11px]">
          <thead>
            <tr className="border-b border-[#eaedf3] text-[#6b7280]">
              <th className="px-4 py-3 font-bold">Tool</th>
              {PLAN_TIERS.map((tier) => (
                <th key={tier} className="px-4 py-3 font-bold">{planName(tier)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TOOL_IDS.map((toolId) => (
              <tr key={toolId} className="border-b border-[#eaedf3] last:border-0 align-top">
                <td className="px-4 py-3 font-bold text-[#111827] whitespace-nowrap">
                  {ALL_TOOLS.find((tool) => tool.id === toolId)?.title ?? toolId}
                </td>
                {PLAN_TIERS.map((tier) => (
                  <td key={tier} className="px-4 py-3 text-[#4b5563]">{toolLimitSummary(toolId, tier)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[#6b7280] leading-relaxed">
        Sizes are per file unless marked &quot;in total&quot;, which counts all the files in one conversion. {VIDEO_LENGTH_NOTE}
      </p>
    </div>
  );
}
