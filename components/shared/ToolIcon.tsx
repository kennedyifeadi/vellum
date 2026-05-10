import React from 'react';
import { ALL_TOOLS } from '@/lib/tools';

type ToolIconProps = {
  toolName: string;
  containerClassName?: string;
  iconClassName?: string;
};

export default function ToolIcon({ 
  toolName, 
  containerClassName = "w-8 h-8 rounded-lg flex shrink-0 items-center justify-center",
  iconClassName = "w-4 h-4"
}: ToolIconProps) {
  const tool = ALL_TOOLS.find(t => t.title === toolName);
  
  const bg = tool?.bgColor || 'bg-[#f3f4f6]';
  const color = tool?.iconColor || 'text-[#6b7280]';
  
  const defaultIcon = (
    <svg className={iconClassName} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
    </svg>
  );

  const iconToRender = tool?.icon ? (
    React.isValidElement(tool.icon) 
      ? React.cloneElement(tool.icon as React.ReactElement<{ className?: string; width?: string; height?: string }>, { 
          className: iconClassName, 
          width: "1em", // overriding hardcoded 20
          height: "1em" 
        }) 
      : tool.icon
  ) : defaultIcon;

  return (
    <div className={`${containerClassName} ${bg} ${color}`}>
      {iconToRender}
    </div>
  );
}
