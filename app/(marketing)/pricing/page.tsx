"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import PricingCompareTable from "@/components/marketing/PricingCompareTable";
import ToolsCarousel from "@/components/marketing/ToolsCarousel";

export default function PricingPage() {
  const [isYearly, setIsYearly] = useState(true);

  const plans = [
    {
      name: "Free",
      description: "Try for free without an account",
      priceMonthly: 0,
      priceYearly: 0,
      limitLabel: "Guest access limits",
      features: [
        "25MB Max File Size (50MB Video)",
        "3 Files per Batch Conversion",
        "10 Pages for PDF Search",
        "No File Retention",
        "No Cloud Storage"
      ],
      buttonText: "Start for Free",
      buttonLink: "/login",
      isPrimary: false,
    },
    {
      name: "Basic",
      description: "Creative personal sites and workflows",
      priceMonthly: 10,
      priceYearly: 8, // $96/yr
      limitLabel: "Increased usage limits",
      features: [
        "50MB Max File Size (100MB Video)",
        "30 Files per Batch Conversion",
        "50 Pages for PDF Search",
        "3 Days File Retention",
        "5GB Cloud Storage"
      ],
      buttonText: "Start with Basic",
      buttonLink: "/signup",
      isPrimary: false,
    },
    {
      name: "Pro",
      description: "Growing professional sites and workflows",
      priceMonthly: 30,
      priceYearly: 24, // $288/yr
      limitLabel: "Professional limits",
      features: [
        "100MB Max File Size (500MB Video)",
        "50 Files per Batch Conversion",
        "100 Pages for PDF Search",
        "5 Days File Retention",
        "20GB Cloud Storage"
      ],
      buttonText: "Start with Pro",
      buttonLink: "/signup?plan=pro",
      isPrimary: true,
    },
    {
      name: "Enterprise",
      description: "Mission critical workflows and high volume",
      priceMonthly: "Custom",
      priceYearly: "Custom",
      limitLabel: "Custom configurable limits",
      features: [
        "Custom Max File Sizes",
        "Custom Batch Conversions",
        "Unlimited PDF Search",
        "Uptime Guarantee",
        "Custom Cloud Storage",
        "Dedicated Support"
      ],
      buttonText: "Contact Us",
      buttonLink: "mailto:contact@vellum.com",
      isPrimary: false,
    }
  ];

  return (
    <div className="min-h-screen pt-10 pb-32 max-w-350 mx-auto px-6">
      <div className="mx-auto px-6 lg:px-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
          <div className="max-w-2xl">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 mb-4 leading-tight">
              Start free, then <br className="hidden md:block" /> scale your workflow
            </h1>
          </div>
          
          {/* Billing Toggle */}
          <div className="flex items-center gap-3 pb-2">
            <span className={`text-sm font-medium ${!isYearly ? "text-gray-900" : "text-gray-500"}`}>Monthly billing</span>
            <button 
              onClick={() => setIsYearly(!isYearly)}
              className="relative inline-flex h-6 w-11 items-center rounded-full bg-blue-600 transition-colors focus:outline-none"
            >
              <span className="sr-only">Toggle billing period</span>
              <span 
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isYearly ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
            <span className={`text-sm font-medium ${isYearly ? "text-gray-900" : "text-gray-500"}`}>Yearly billing</span>
          </div>
        </div>

        {/* Pricing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 border border-gray-200 rounded-2xl">
          {plans.map((plan, index) => (
            <motion.div 
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`flex flex-col p-8 border-b lg:border-b-0 ${index !== plans.length - 1 ? 'lg:border-r border-gray-200' : ''}`}
            >
              {/* Card Header */}
              <div className="mb-6">
                <h3 className="text-xl font-semibold text-gray-900">{plan.name}</h3>
                <p className="text-sm text-gray-500 mt-1 h-10">{plan.description}</p>
              </div>

              {/* Price */}
              <div className="mb-6 flex items-baseline gap-2">
                <span className="text-4xl font-bold tracking-tight text-gray-900">
                  {typeof plan.priceMonthly === 'number' ? `$${isYearly ? plan.priceYearly : plan.priceMonthly}` : plan.priceMonthly}
                </span>
                {typeof plan.priceMonthly === 'number' && (
                  <span className="text-sm font-medium text-gray-500">per month</span>
                )}
              </div>

              {/* Limits Box */}
              <div className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 mb-8 text-sm font-medium text-gray-700 text-center">
                {plan.limitLabel}
              </div>

              {/* Features */}
              <ul className="flex-1 space-y-4 mb-8">
                {plan.features.map((feature, fIdx) => (
                  <li key={fIdx} className="flex items-start gap-3">
                    <svg className="h-5 w-5 shrink-0 text-gray-400 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm text-gray-600 leading-tight">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA Button */}
              <Link 
                href={plan.buttonLink}
                className={`w-full py-3 px-4 rounded-xl text-sm font-semibold text-center transition-all ${
                  plan.isPrimary 
                    ? "bg-indigo-600 text-white hover:bg-indigo-700" 
                    : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                }`}
              >
                {plan.buttonText}
              </Link>
            </motion.div>
          ))}
        </div>

        <PricingCompareTable />
        <div className="md:mt-32 mt-12">
          <ToolsCarousel />
        </div>
        <div className="mt-12 text-center text-sm text-gray-500">
          <p>Enterprise custom workflows require individual setup. <a href="mailto:contact@vellum.com" className="text-blue-600 hover:underline">Contact sales</a> to learn more.</p>
        </div>

      </div>
    </div>
  );
}
