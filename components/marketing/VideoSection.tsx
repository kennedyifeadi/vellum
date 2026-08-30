'use client';

import { motion } from 'framer-motion';

export default function VideoSection() {
  return (
    <section className="relative z-20 -mt-30 pb-32 flex flex-col items-center justify-center overflow-hidden">
      
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative w-[95%] h-120 sm:h-145 lg:h-180 rounded-2xl overflow-hidden border border-gray-200 shadow-sm"
      >
        <video 
          src="/Vellum Video 2.mp4" 
          autoPlay 
          muted 
          loop 
          playsInline 
          className="w-full h-full object-cover object-center"
        />
      </motion.div>
      
    </section>
  );
}
