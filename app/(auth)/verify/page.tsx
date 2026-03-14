"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  AuthLayout, 
  AuthCard, 
  AuthButton, 
  VellumLogo 
} from "@/components/auth/AuthComponents";

function VerifyPageContent() {
  const [otp, setOtp] = useState<string[]>(new Array(6).fill(""));
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!email) {
      router.push("/login");
      return;
    }
    // Focus first input on mount
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [email, router]);

  const handleChange = (element: HTMLInputElement, index: number) => {
    if (isNaN(Number(element.value))) return false;

    const newOtp = [...otp];
    newOtp[index] = element.value;
    setOtp(newOtp);

    // Focus next input
    if (element.value !== "" && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length !== 6) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.isNewUser || !data.user.isProfileComplete) {
          router.push("/signup-details");
        } else {
          router.push("/dashboard");
        }
      } else {
        const data = await response.json();
        alert(data.error || "Verification failed.");
      }
    } catch (error) {
      console.error("Error verifying OTP:", error);
      alert("An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    try {
      const response = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.ok) {
        alert("Verification code resent!");
      } else {
        alert("Failed to resend code.");
      }
    } catch (error) {
      console.error("Error resending OTP:", error);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard>
        <VellumLogo />
        
        <div className="w-16 h-16 bg-[#f3f4ff] rounded-full flex items-center justify-center mb-6 text-[#6366f1]">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-[#111827] mb-2 text-center">Check your email</h1>
        <p className="text-[#6b7280] text-sm mb-8 text-center max-w-[280px]">
          We&apos;ve sent a 6-digit code to <br />
          <span className="font-semibold text-[#374151]">{email}</span>
        </p>

        <div className="flex gap-2 mb-8 justify-center">
          {otp.map((data, index) => (
            <input
              key={index}
              type="text"
              maxLength={1}
              ref={(el) => { inputRefs.current[index] = el }}
              value={data}
              onChange={(e) => handleChange(e.target, index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className="w-12 h-14 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl text-center text-xl font-bold text-[#111827] outline-none transition-all focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/10"
            />
          ))}
        </div>

        <AuthButton onClick={handleVerify} disabled={isLoading || otp.some(v => v === "")}>
          {isLoading ? "Verifying..." : "Verify & Continue →"}
        </AuthButton>

        <div className="mt-8 text-center">
            <p className="text-xs text-[#6b7280]">
                Didn&apos;t receive a code?{" "}
                <button 
                  onClick={handleResend}
                  disabled={isResending}
                  className="text-[#6366f1] font-semibold hover:underline disabled:opacity-50"
                >
                  {isResending ? "Resending..." : "Click to resend"}
                </button>
            </p>
            
            <button 
                onClick={() => router.push("/login")}
                className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-[#6b7280] hover:text-[#374151] transition-colors mx-auto"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to login
            </button>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}

export default function VerifyPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <VerifyPageContent />
        </Suspense>
    );
}
