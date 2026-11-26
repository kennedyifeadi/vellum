import type { Tool } from '@/lib/tools';

export const SOLUTIONS_PATH = '/solutions';

export const SOLUTIONS_TITLE = 'Solutions | Vellum';

/** The address of a tool's own Solutions page, which opens Solutions with that tool's sheet. */
export const toolPath = (id: string) => `${SOLUTIONS_PATH}/${id}`;

export const toolPageTitle = (tool: Pick<Tool, 'title'>) => `${tool.title} | Vellum`;
