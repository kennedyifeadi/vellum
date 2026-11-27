"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SideDrawer from '@/components/dashboard/SideDrawer';
import ToolIcon from '@/components/shared/ToolIcon';
import { ALL_TOOLS } from '@/lib/tools';
import { SOLUTIONS_PATH, SOLUTIONS_TITLE, toolPageTitle, toolPath } from '@/lib/solutions-pages';

function toolAt(pathname: string): string | null {
  const id = pathname.startsWith(`${SOLUTIONS_PATH}/`) ? pathname.slice(SOLUTIONS_PATH.length + 1) : null;
  return ALL_TOOLS.some((tool) => tool.id === id) ? id : null;
}

/**
 * The Solutions list and its tool sheet. Each open tool has its own address: opening and closing
 * one changes it without a reload, and Back closes the sheet, except while a file is processing.
 */
export default function SolutionsTools({ initialTool }: { initialTool: string | null }) {
  const [openTool, setOpenTool] = useState(initialTool);
  // Kept after the sheet closes, so it keeps its content while it slides away.
  const [shownTool, setShownTool] = useState(initialTool);
  const openToolRef = useRef(initialTool);
  const busyRef = useRef(false);
  // Set when this page pushed the open tool's history entry, so closing goes back over it.
  const pushedEntryRef = useRef(false);
  const closingRef = useRef(false);

  // A shallow address change leaves the page's metadata as it was, so the title follows here.
  useEffect(() => {
    openToolRef.current = openTool;
    const tool = ALL_TOOLS.find((t) => t.id === openTool);
    document.title = tool ? toolPageTitle(tool) : SOLUTIONS_TITLE;
  }, [openTool]);

  useEffect(() => {
    const onPopState = () => {
      pushedEntryRef.current = false;
      if (closingRef.current) {
        closingRef.current = false;
        setOpenTool(null);
        return;
      }
      if (busyRef.current && openToolRef.current) {
        window.history.pushState(null, '', toolPath(openToolRef.current));
        pushedEntryRef.current = true;
        return;
      }
      const tool = toolAt(window.location.pathname);
      if (tool) setShownTool(tool);
      setOpenTool(tool);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const open = (id: string) => {
    window.history.pushState(null, '', toolPath(id));
    pushedEntryRef.current = true;
    setShownTool(id);
    setOpenTool(id);
  };

  const close = () => {
    if (pushedEntryRef.current) {
      pushedEntryRef.current = false;
      closingRef.current = true;
      window.history.back();
    } else {
      window.history.replaceState(null, '', SOLUTIONS_PATH);
      setOpenTool(null);
    }
  };

  const onBusyChange = (busy: boolean) => {
    busyRef.current = busy;
  };

  const onToolLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open(id);
  };

  return (
    <div className="pt-20 pb-32">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl mb-6">Our Solutions</h1>
        <p className="text-lg text-gray-600 leading-relaxed">
          Explore all the tools available in Vellum.
        </p>
      </div>
      <ul className="max-w-3xl mx-auto px-6 mt-12 grid gap-3 sm:grid-cols-2">
        {ALL_TOOLS.map((tool) => (
          <li key={tool.id}>
            <Link
              href={toolPath(tool.id)}
              onClick={(e) => onToolLinkClick(e, tool.id)}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <ToolIcon toolName={tool.title} />
              <span className="text-sm font-semibold">{tool.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      <SideDrawer
        key={shownTool ?? 'none'}
        presentation="sheet"
        isOpen={openTool !== null}
        onClose={close}
        file={null}
        toolId={shownTool}
        onBusyChange={onBusyChange}
      />
    </div>
  );
}
