import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ALL_TOOLS } from '@/lib/tools';
import SolutionsTools from '@/components/marketing/SolutionsTools';
import { toolPageTitle } from '@/lib/solutions-pages';

type SolutionsToolPageProps = { params: Promise<{ tool: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_TOOLS.map((tool) => ({ tool: tool.id }));
}

async function toolOf({ params }: SolutionsToolPageProps) {
  const { tool: id } = await params;
  const tool = ALL_TOOLS.find((t) => t.id === id);
  if (!tool) notFound();
  return tool;
}

export async function generateMetadata(props: SolutionsToolPageProps): Promise<Metadata> {
  const tool = await toolOf(props);
  return { title: toolPageTitle(tool), description: tool.desc };
}

export default async function SolutionsToolPage(props: SolutionsToolPageProps) {
  const tool = await toolOf(props);
  return <SolutionsTools initialTool={tool.id} />;
}
