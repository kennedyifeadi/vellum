"use client";

import { Fragment, useEffect, useRef } from "react";
import { CODE_GROUP_LENGTH, CODE_LENGTH, readCodeCharacters } from "@/lib/auth/signInInput";

const BOXES = Array.from({ length: CODE_LENGTH }, (_, index) => index);
const GROUPS = [BOXES.slice(0, CODE_GROUP_LENGTH), BOXES.slice(CODE_GROUP_LENGTH)];

interface CodeInputProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function CodeInput({ value, onChange }: CodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const focusBox = (index: number) => {
    inputRefs.current[Math.min(Math.max(index, 0), CODE_LENGTH - 1)]?.focus();
  };

  const clearBox = (index: number) => {
    onChange(value.map((character, i) => (i === index ? "" : character)));
  };

  const enterText = (index: number, text: string) => {
    const characters = readCodeCharacters(text);
    if (!characters || characters.length > CODE_LENGTH) return;

    const start = characters.length === CODE_LENGTH ? 0 : index;
    onChange(value.map((character, i) => characters[i - start] ?? character));
    focusBox(start + characters.length);
  };

  const handleChange = (text: string, index: number) => {
    if (text === "") return clearBox(index);
    // No maxLength, which would cut short an autofilled code, so a filled box can briefly hold two.
    const held = value[index];
    enterText(index, held && text.length === 2 ? text.replace(held, "") : text);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    e.preventDefault();
    enterText(index, e.clipboardData.getData("text"));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    const moves: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: CODE_LENGTH - 1,
    };
    // Typing the character a box already holds changes nothing, so no change event moves on.
    const retyped = !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toUpperCase() === value[index];

    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      const target = e.key === "Backspace" && !value[index] ? Math.max(index - 1, 0) : index;
      clearBox(target);
      focusBox(target);
    } else if (e.key in moves || retyped) {
      e.preventDefault();
      focusBox(retyped ? index + 1 : moves[e.key]);
    }
  };

  return (
    <div role="group" aria-label="Verification code" className="flex w-full items-center gap-1.5 mb-8">
      {GROUPS.map((group, groupIndex) => (
        <Fragment key={groupIndex}>
          {groupIndex > 0 && <span aria-hidden="true" className="text-[#9ca3af]">-</span>}
          <div className="flex flex-1 min-w-0 gap-1 md:gap-1.5">
            {group.map((index) => (
              <input
                key={index}
                type="text"
                aria-label={`Character ${index + 1} of ${CODE_LENGTH}`}
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                ref={(el) => { inputRefs.current[index] = el }}
                value={value[index]}
                onChange={(e) => handleChange(e.target.value, index)}
                onPaste={(e) => handlePaste(e, index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onFocus={(e) => e.target.select()}
                className="w-full min-w-0 h-12 md:h-14 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl text-center text-lg md:text-xl font-bold text-[#111827] outline-none transition-all focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/10"
              />
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
