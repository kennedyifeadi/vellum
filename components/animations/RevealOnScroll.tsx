import { motion } from 'framer-motion';

interface RevealOnScrollProps {
  children: React.ReactNode;
  duration?: number;
  delay?: number;
}

export const RevealOnScroll = ({ children, duration = 0.8, delay = 0 }: RevealOnScrollProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }} // Trigger when 50% of the element is in view
      transition={{ duration, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
};