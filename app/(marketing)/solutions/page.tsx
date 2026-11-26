import type { Metadata } from 'next';
import SolutionsTools from '@/components/marketing/SolutionsTools';
import { SOLUTIONS_TITLE } from '@/lib/solutions-pages';

export const metadata: Metadata = {
  title: SOLUTIONS_TITLE,
  description: 'Every Vellum tool for PDFs, images and videos, ready to use in your browser, with or without an account.',
};

export default function SolutionsPage() {
  return <SolutionsTools initialTool={null} />;
}
