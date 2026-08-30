"use client";

import Antigravity from "@/components/marketing/AntigravityEffect";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import Image from "next/image";
import Doc from "@/public/Tools Assest/Doc.png";
import VideoComp from "@/public/Tools Assest/VideoCom.png";
import Find from "@/public/Tools Assest/Find.png";
import HTML from "@/public/Tools Assest/HTML.png";
import ImageIcon from "@/public/Tools Assest/Image.png";
import ImageCom from "@/public/Tools Assest/ImageCom.png";
import PDF from "@/public/Tools Assest/PDF.png";
import Merge from "@/public/Tools Assest/Merge.png";
import Split from "@/public/Tools Assest/Split.png";
import Conversion from "@/public/Tools Assest/Conversion.png";
import Lock from "@/public/Tools Assest/Lock.png";
import { StaticImport } from "next/dist/shared/lib/get-img-props";
import TargetCursor from "./TargetCursor";
// Small icons
const CloudIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  </svg>
);
const FileIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const DownloadIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);
const UploadIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
);
const CloudDownIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    <path d="M12 12v5M9 15l3 3 3-3" />
  </svg>
);
const ChatIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const FileTextIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" x2="8" y1="13" y2="13" />
    <line x1="16" x2="8" y1="17" y2="17" />
    <line x1="10" x2="8" y1="9" y2="9" />
  </svg>
);
const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const SparkleIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v18M3 12h18M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728" />
  </svg>
);
const ZipIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M8 12h2v2H8zm2 2h2v2h-2zm-2 2h2v2H8z" />
  </svg>
);

const VellumToolsIcon = ({
  icon: Icon,
  x,
  y,
  size,
  direction = 1,
}: {
  icon: StaticImport;
  x: number;
  y: number;
  size: number;
  direction?: number;
}) => {
  return (
    <motion.div
      className="absolute pointer-events-auto z-10"
      style={{
        left: x,
        top: y,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        width: size,
        height: size,
      }}
      animate={{ rotate: -360 * direction }}
      transition={{ repeat: Infinity, duration: 240, ease: "linear" }}
    >
      <Image src={Icon} alt="Tool Icon" width={size} height={size} />
    </motion.div>
  );
};

const SmallNode = ({
  x,
  y,
  icon: Icon,
  size = 40,
  direction = 1,
}: {
  x: number;
  y: number;
  icon: React.ElementType;
  size?: number;
  direction?: number;
}) => (
  <motion.div
    className={`absolute flex items-center justify-center bg-[#F3F4F6] text-gray-400 z-10 rounded-full`}
    style={{
      left: x,
      top: y,
      marginLeft: -size / 2,
      marginTop: -size / 2,
      width: size,
      height: size,
    }}
    animate={{ rotate: -360 * direction }}
    transition={{ repeat: Infinity, duration: 240, ease: "linear" }}
  >
    <Icon className="w-4.5 h-4.5" />
  </motion.div>
);

export default function HeroSection() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="relative w-full min-h-screen flex flex-col items-center justify-center font-sans bg-white hero-section-container">
      <div className="absolute inset-0 z-0 overflow-hidden">
        <Antigravity
          count={100}
          magnetRadius={20}
          ringRadius={10}
          waveSpeed={0.9}
          waveAmplitude={1}
          particleSize={0.7}
          lerpSpeed={0.05}
          color="#3858fb"
          autoAnimate
          particleVariance={1}
          rotationSpeed={0}
          depthFactor={1.8}
          pulseSpeed={3}
          particleShape="capsule"
          fieldStrength={16.4}
        />
      </div>

      {/* ── Visual Network Background ── */}
      <div className="absolute top-1/2 left-1/2 w-0 h-0 pointer-events-none z-0">
        {/* SVG Network Lines */}
        <svg
          className="absolute overflow-visible"
          style={{ width: 1600, height: 1600, top: -800, left: -800 }}
        >
          <g stroke="#E5E7EB" strokeWidth="1.5" fill="none">
            {/* Concentric Rings */}
            <circle cx="800" cy="800" r="480" />
            <circle cx="800" cy="800" r="640" />
            <circle cx="800" cy="800" r="820" />
            <circle cx="800" cy="800" r="920" />
            <circle cx="800" cy="800" r="1020" />

            <path d="M 1425 665 C 1454 785 1278 802 1267 911" />
            <path d="M 177 652 C 147 842 317 767 332 908" />
          </g>
        </svg>

        {/* ── Orbiting Icons Group ── */}

        {/* Ring 1 - Clockwise */}
        <motion.div
          className="absolute inset-0"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 240, ease: "linear" }}
        >
          {/* Major Glass Icons (Ring 1) */}
          <VellumToolsIcon x={480} y={0} icon={Merge} size={100} />
          <VellumToolsIcon x={148} y={456} icon={PDF} size={80} />
          <VellumToolsIcon x={-388} y={282} icon={VideoComp} size={100} />
          <VellumToolsIcon x={-388} y={-282} icon={Split} size={80} />
          <VellumToolsIcon x={148} y={-456} icon={ImageCom} size={80} />

          {/* Small Nodes (Ring 1) */}
          <SmallNode x={388} y={282} icon={SparkleIcon} />
          <SmallNode x={-148} y={456} icon={DownloadIcon} />
          <SmallNode x={-480} y={0} icon={CheckIcon} />
          <SmallNode x={-148} y={-456} icon={CloudIcon} />
          <SmallNode x={388} y={-282} icon={ChatIcon} />
        </motion.div>

        {/* Ring 2 - Counter-Clockwise */}
        <motion.div
          className="absolute inset-0"
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 240, ease: "linear" }}
        >
          {/* Major Glass Icons (Ring 2) */}
          <VellumToolsIcon
            x={640}
            y={0}
            icon={Conversion}
            size={80}
            direction={-1}
          />
          <VellumToolsIcon
            x={271}
            y={580}
            icon={Doc}
            size={80}
            direction={-1}
          />
          <VellumToolsIcon
            x={-420}
            y={483}
            icon={ImageIcon}
            size={80}
            direction={-1}
          />
          <VellumToolsIcon
            x={-615}
            y={-177}
            icon={Lock}
            size={80}
            direction={-1}
          />
          <VellumToolsIcon
            x={-89}
            y={-634}
            icon={Find}
            size={80}
            direction={-1}
          />
          <VellumToolsIcon
            x={537}
            y={-349}
            icon={HTML}
            size={80}
            direction={-1}
          />

          {/* Small Nodes (Ring 2) */}
          <SmallNode x={537} y={349} icon={FileIcon} direction={-1} />
          <SmallNode x={-89} y={634} icon={CloudDownIcon} direction={-1} />
          <SmallNode x={-615} y={177} icon={UploadIcon} direction={-1} />
          <SmallNode x={-420} y={-483} icon={FileTextIcon} direction={-1} />
          <SmallNode x={271} y={-580} icon={ZipIcon} direction={-1} />
        </motion.div>
      </div>

      {/* ── Central Text Content ── */}
      <div className="relative z-30 text-center max-w-200 px-6 pointer-events-auto">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-sm font-bold tracking-widest uppercase text-indigo-600 mb-6"
        >
          Vellum Tools
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 15 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-[3.5rem] md:text-[5.5rem] font-extrabold leading-[1.05] tracking-tight text-gray-900 mb-6 cursor-h1-container"
        >
          <TargetCursor
            spinDuration={2}
            hideDefaultCursor
            parallaxOn
            hoverDuration={0.2}
            cursorColor="#000"
            cursorColorOnTarget="#3858fb"
            containerSelector=".cursor-h1-container"
          />
          <span className="cursor-target">Your all-in-one</span>
          <br />
          <span className="cursor-target">file toolkit</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 15 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-lg md:text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed font-medium"
        >
          Convert, compress, merge, split and protect your files — PDF, images,
          video and documents. All beautifully fast, secure, and free.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            href="/sign-up"
            className="px-8 py-4 rounded-full bg-indigo-600 text-white text-[15px] font-semibold hover:bg-indigo-700 transition-all shadow-lg hover:shadow-indigo-500/30 flex items-center gap-2"
          >
            Get Started Free
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </Link>

          <Link
            href="/dashboard"
            className="px-8 py-4 rounded-full bg-white text-gray-900 text-[15px] font-semibold hover:bg-gray-50 border border-gray-200 transition-all shadow-sm flex items-center gap-2"
          >
            Explore tools
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
