import type { Tool } from '@/lib/tools';

export const SOLUTIONS_TITLE = 'Solutions | Vellum';

export const toolPageTitle = (tool: Pick<Tool, 'title'>) => `${tool.title} | Vellum`;
