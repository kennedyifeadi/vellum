"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 
  AuthLayout, 
  AuthCard, 
  AuthInput, 
  AuthButton, 
  VellumLogo 
} from "@/components/auth/AuthComponents";

export default function SignupDetailsPage() {
  const [formData, setFormData] = useState({
    name: "",
    role: "",
    currentGoal: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === "currentGoal" && value.length > 140) return;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.role) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/complete-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        router.push("/dashboard");
      } else {
        const data = await response.json();
        alert(data.error || "Failed to update profile.");
      }
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard>
        <div className="w-full flex flex-col items-center">
            <VellumLogo />
            
            <h1 className="text-2xl font-bold text-[#111827] mb-2 text-center">Almost there!</h1>
            <p className="text-[#6b7280] text-sm mb-8 text-center max-w-[320px]">
              Tell us a bit about yourself to personalize your experience.
            </p>

            <div className="w-full space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[#374151] ml-0.5">
                  Full Name
                </label>
                <AuthInput
                  name="name"
                  placeholder="e.g. Alex Morgan"
                  value={formData.name}
                  onChange={handleInputChange}
                  icon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  }
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[#374151] ml-0.5">
                  Current Role
                </label>
                <div className="relative group">
                    <select
                        name="role"
                        value={formData.role}
                        onChange={handleInputChange}
                        className="w-full h-12 px-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl text-[#111827] outline-none transition-all focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/10 appearance-none"
                    >
                        <option value="" disabled>Select your role</option>
                        <option value="Software Engineer">Software Engineer</option>
                        <option value="Product Manager">Product Manager</option>
                        <option value="Designer">Designer</option>
                        <option value="Student">Student</option>
                        <option value="Other">Other</option>
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[#9ca3af]">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
              </div>

              <div className="space-y-1.5 text-right">
                <label className="text-sm font-medium text-[#374151] ml-0.5 block text-left">
                  Primary Goal
                </label>
                <textarea
                  name="currentGoal"
                  placeholder="What will you use Vellum for?"
                  value={formData.currentGoal}
                  onChange={handleInputChange}
                  className="w-full h-32 p-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl text-[#111827] placeholder-[#9ca3af] outline-none transition-all focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/10 resize-none"
                />
                <span className="text-[10px] text-[#9ca3af] mr-1">
                    {formData.currentGoal.length}/140 characters
                </span>
              </div>

              <AuthButton onClick={handleSubmit} disabled={isLoading || !formData.name || !formData.role}>
                {isLoading ? "Saving..." : "Enter Dashboard →"}
              </AuthButton>
            </div>
        </div>

        <div className="w-full mt-10 border-t border-[#f1f1f1] pt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 bg-[#f3f4ff] rounded-full overflow-hidden">
                    <div className="w-full h-full bg-[#6366f1] rounded-full" />
                </div>
                <span className="text-[11px] font-medium text-[#6b7280]">Step 3 of 3</span>
            </div>
            <button 
                onClick={() => router.push("/dashboard")}
                className="text-[11px] font-semibold text-[#6b7280] hover:text-[#374151] transition-colors"
            >
                Skip for now
            </button>
        </div>
      </AuthCard>

      <div className="mt-8 text-center text-xs text-[#6b7280]">
        Need help setting up? <a href="#" className="text-[#6366f1] hover:underline font-medium">Read our guide</a>
      </div>
    </AuthLayout>
  );
}
