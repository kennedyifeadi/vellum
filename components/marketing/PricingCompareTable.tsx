import React from 'react';

const compareData = [
  {
    category: "Conversion Limits",
    features: [
      { name: "Max File Size (Image/Doc)", free: "25MB", basic: "50MB", pro: "100MB", enterprise: "Custom" },
      { name: "Max File Size (Video)", free: "50MB", basic: "100MB", pro: "500MB", enterprise: "Custom" },
      { name: "Batch Conversion Limit", free: "3 files", basic: "30 files", pro: "50 files", enterprise: "Custom" },
    ]
  },
  {
    category: "PDF Tools",
    features: [
      { name: "PDF Merge", free: "Yes", basic: "Yes", pro: "Yes", enterprise: "Yes" },
      { name: "PDF Split & Extract", free: "Yes", basic: "Yes", pro: "Yes", enterprise: "Yes" },
      { name: "PDF to DOCX", free: "Yes", basic: "Yes", pro: "Yes", enterprise: "Yes" },
      { name: "PDF Search Limit", free: "10 pages", basic: "50 pages", pro: "100 pages", enterprise: "Unlimited" },
    ]
  },
  {
    category: "Image Tools",
    features: [
      { name: "Image to PDF", free: "Yes", basic: "Yes", pro: "Yes", enterprise: "Yes" },
      { name: "JPEG to PNG", free: "Yes", basic: "Yes", pro: "Yes", enterprise: "Yes" },
      { name: "Image Compress", free: "Yes", basic: "Yes", pro: "Yes", enterprise: "Yes" },
    ]
  },
  {
    category: "Video Tools",
    features: [
      { name: "Video Compress", free: "Yes", basic: "Yes", pro: "Yes", enterprise: "Yes" },
    ]
  },
  {
    category: "Storage & Access",
    features: [
      { name: "Cloud Storage", free: "None", basic: "5GB", pro: "20GB", enterprise: "Custom" },
      { name: "File Retention", free: "None", basic: "3 Days", pro: "5 Days", enterprise: "Custom" },
      { name: "Access Anywhere", free: "No", basic: "Yes", pro: "Yes", enterprise: "Yes" },
    ]
  },
  {
    category: "Support & Security",
    features: [
      { name: "Customer Support", free: "Community", basic: "Standard", pro: "Priority", enterprise: "Dedicated" },
      { name: "Uptime Guarantee", free: "No", basic: "No", pro: "No", enterprise: "Yes" },
      { name: "API Access", free: "No", basic: "No", pro: "No", enterprise: "Yes" },
    ]
  }
];

const Checkmark = () => (
  <svg className="w-4 h-4 mx-auto text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
  </svg>
);

const Cross = () => (
  <svg className="w-4 h-4 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
  </svg>
);

const renderValue = (value: string) => {
  if (value === "Yes") return <Checkmark />;
  if (value === "No") return <Cross />;
  return <span className="text-gray-900 font-medium">{value}</span>;
};

export default function PricingCompareTable() {
  return (
    <div className="mt-32">
      <div className="mb-12">
        <h2 className="mt-4 text-xl font-normal tracking-tight">Find the perfect set of features for your workflow.</h2>
      </div>
      
      <div className="overflow-x-auto pb-4">
        <div className="min-w-200">
          
          {/* Table Header */}
          <div className="grid grid-cols-5 gap-4 py-4 border-b border-gray-200 sticky top-0 bg-transparent z-10">
            <div className="col-span-1 text-left font-semibold text-lg text-gray-900 pl-4">Features</div>
            <div className="col-span-1 text-center font-semibold text-lg text-gray-900">Free</div>
            <div className="col-span-1 text-center font-semibold text-lg text-gray-900">Basic</div>
            <div className="col-span-1 text-center font-semibold text-lg text-gray-900">Pro</div>
            <div className="col-span-1 text-center font-semibold text-lg text-gray-900">Enterprise</div>
          </div>

          {/* Table Body */}
          <div className="mt-8 space-y-12">
            {compareData.map((section, idx) => (
              <div key={idx}>
                {/* Section Title */}
                <h3 className="text-left font-bold text-gray-900 text-lg py-3 pl-4 bg-gray-50/50 rounded-lg">
                  {section.category}
                </h3>
                
                {/* Section Rows */}
                <div className="mt-2 flex flex-col">
                  {section.features.map((feature, fIdx) => (
                    <div 
                      key={fIdx} 
                      className="grid grid-cols-5 gap-4 py-4 border-b border-gray-100 hover:bg-gray-50 transition-colors duration-150"
                    >
                      <div className="col-span-1 text-left text-sm text-gray-600 pl-4 flex items-center">
                        {feature.name}
                      </div>
                      <div className="col-span-1 text-center text-sm flex items-center justify-center">
                        {renderValue(feature.free)}
                      </div>
                      <div className="col-span-1 text-center text-sm flex items-center justify-center">
                        {renderValue(feature.basic)}
                      </div>
                      <div className="col-span-1 text-center text-sm flex items-center justify-center">
                        {renderValue(feature.pro)}
                      </div>
                      <div className="col-span-1 text-center text-sm flex items-center justify-center">
                        {renderValue(feature.enterprise)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
