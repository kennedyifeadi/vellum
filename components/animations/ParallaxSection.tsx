import { motion, useScroll, useTransform } from 'framer-motion';

interface ParallaxSectionProps {
  children: React.ReactNode;
  speed?: number; // Controls the intensity of the parallax effect
}

export const ParallaxSection = ({ children, speed = -200 }: ParallaxSectionProps) => {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, speed]);

  return (
    <motion.div style={{ y }}>
      {children}
    </motion.div>
  );
};